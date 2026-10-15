// Backup alerts: the backup gateway (Protonic's backup system) sends its
// alerts here, and each one becomes a ticket, so problems with a client's
// backups are handled like any other request.
//
//   POST /api/integrations/backup/webhook    the gateway sends alerts (no sign-in:
//                                            checked with the shared secret instead)
//   GET  /api/integrations/backup            the settings, and the gateway's clients
//   POST /api/integrations/backup            { enabled, departmentId }
//   POST /api/integrations/backup/secret     makes a new secret (shown once)
//   POST /api/integrations/backup/clients/:id  { customerId }  which customer a client is
//
// Where alerts go (alerts.js): the Alerts page, not the Inbox.
//   - One alert per problem, per device: "malware on reception-pc",
//     "front-desk offline". More alerts about the same problem while it's
//     open are counted on it, and the most serious severity wins.
//   - "Back to normal" (a device back online, disk space back) resolves it.
//   - Critical alerts also make a ticket by themselves (for the team chosen
//     here); the others only when someone presses "Make a ticket".
//   - High and critical alerts notify that team (or everyone on staff).
//   - The alert is for the customer the gateway's client is linked to. A
//     client nobody has linked yet gets a customer made with its name;
//     linking it later moves its alerts and tickets to the real customer.
//   - Tickets made from alerts are for the team only: customers don't see
//     them in the customer portal, and they don't get "we got your request"
//     or "how did we do?" emails.
//   - Tickets made from alerts before the Alerts page existed stay as they
//     are; new alerts no longer add to them.
//
// Security: the gateway signs each request with the secret made here
// (HMAC-SHA256 of "timestamp.body"). Anything not signed with it, or more than
// 5 minutes old, is refused. The secret is kept locked (secrets.js) and only
// shown once, when it's made.
import crypto from "node:crypto";
import { Router } from "express";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  alerts,
  backupAlerts,
  backupClients,
  backupEvents,
  customers,
  departments,
  messages,
  settings,
  tickets,
  users,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS } from "./permissions.js";
import { BadInput } from "./validate.js";
import { seal, unseal } from "./secrets.js";
import { recordEvent } from "./activity.js";
import { afterTicketEvent } from "./automation.js";
import { sendToEveryone } from "./live.js";
import {
  addEvent,
  announce as announceAlert,
  makeTicket,
  makesTicket,
  openAlert,
  registerAlertSource,
  tell,
  worse,
} from "./alerts.js";

export const backupAlertsRouter = Router();

const MAX_AGE_MS = 5 * 60 * 1000;
const SETTING = "backupAlerts";
const isDone = (status) => status === "resolved" || status === "closed";

// ---------- Settings ----------

async function setting(key) {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}
async function saveSetting(key, value) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
const newSecret = () => crypto.randomBytes(32).toString("hex");

// ---------- What kind of problem an alert is about ----------

// Alerts about the same problem on the same device go on one ticket
function groupOf(kind) {
  if (kind.startsWith("malware.")) return "malware";
  if (kind.startsWith("ransomware.") || kind === "device.frozen")
    return "ransomware";
  if (kind === "device.offline" || kind === "device.online") return "offline";
  if (kind.startsWith("offsite.")) return "offsite";
  if (kind.startsWith("gateway.disk")) return "disk";
  if (kind.startsWith("engine.")) return "antivirus";
  if (kind.startsWith("agent.update") || kind === "agent.uninstall-failed")
    return "agent";
  if (kind.startsWith("admin.")) return "logins";
  return kind;
}
// "Back to normal" alerts: they close their problem's ticket
const isRecovery = (e) => e.recovers === true || e.kind === "engine.up";

const when = (ms) =>
  new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

// Several alerts that came together, written out as one note: the most
// serious one in full, then the others (the same one many times = one line)
function describeAll(list, gatewayName) {
  const rank = ["info", "low", "medium", "high", "critical"];
  const main = list.reduce(
    (a, e) => (rank.indexOf(e.severity) > rank.indexOf(a.severity) ? e : a),
    list[0],
  );
  const rest = new Map();
  for (const e of list) {
    if (e === main) continue;
    const r = rest.get(e.title) ?? { title: e.title, n: 0, at: e.at };
    r.n++;
    r.at = e.at;
    rest.set(e.title, r);
  }
  if (!rest.size) return describe(main, gatewayName);
  const lines = [...rest.values()].map(
    (r) =>
      `• ${r.title}${r.n > 1 ? ` (${r.n} times, last ${when(Date.parse(r.at) || Date.now())})` : ` (${when(Date.parse(r.at) || Date.now())})`}`,
  );
  return `${describe(main, gatewayName)}\n\nAlso, at the same time:\n${lines.join("\n")}`;
}

// The alert written out for a note
function describe(e, gatewayName) {
  const d = e.detail && typeof e.detail === "object" ? e.detail : {};
  const lines = [e.title];
  if (e.device)
    lines.push(`Device: ${e.device}${e.client ? ` (${e.client})` : ""}`);
  if (d.signature) lines.push(`Malware: ${d.signature}`);
  if (d.path) lines.push(`File: ${d.path}`);
  if (d.error) lines.push(`Error: ${d.error}`);
  lines.push(`Severity: ${e.severity}`);
  lines.push(`When: ${when(Date.parse(e.at) || Date.now())}`);
  lines.push(
    `From the backup gateway "${gatewayName}". The details are on its Security page.`,
  );
  return lines.join("\n");
}

// ---------- Checking what the gateway sent ----------

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);

function cleanEvent(e) {
  if (!e || typeof e !== "object") return null;
  const id = Number(e.id);
  const kind = str(e.kind, 60);
  const title = str(e.title, 300);
  if (!Number.isSafeInteger(id) || !kind || !title) return null;
  return {
    id,
    kind,
    title,
    severity: ["info", "low", "medium", "high", "critical"].includes(e.severity)
      ? e.severity
      : "info",
    at: str(e.at, 40) ?? new Date().toISOString(),
    deviceId: str(e.deviceId, 80),
    device: str(e.device, 200),
    client: str(e.client, 200),
    recovers: e.recovers === true,
    detail: e.detail && typeof e.detail === "object" ? e.detail : null,
  };
}

// The signature is HMAC-SHA256("timestamp.body") with the shared secret
function signedOk(secret, timestamp, signature, raw) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > MAX_AGE_MS)
    return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex")}`;
  const given = String(signature ?? "");
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

// ---------- Clients and customers ----------

async function clientRow(gatewayId, gatewayName, client) {
  const [row] = await db
    .insert(backupClients)
    .values({ gatewayId, gatewayName, client })
    .onConflictDoUpdate({
      target: [backupClients.gatewayId, backupClients.client],
      set: { gatewayName, lastSeenAt: new Date() },
    })
    .returning();
  return row;
}

// The customer a client's tickets are for. Not linked yet: one is made with
// the client's name (linking it to the real customer later moves the tickets)
async function customerFor(row) {
  if (row.customerId) {
    const [c] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, row.customerId));
    if (c) return c;
  }
  const name =
    row.client || `${row.gatewayName || "Backup gateway"} (backup gateway)`;
  const [c] = await db
    .insert(customers)
    .values({ name, company: row.client || null, email: null })
    .returning();
  await db
    .update(backupClients)
    .set({ customerId: c.id, madeCustomer: true })
    .where(eq(backupClients.id, row.id));
  return c;
}

// ---------- Turning alerts into an alert on the Alerts page ----------

async function addNote(ticketId, author, body, at = new Date()) {
  await db
    .insert(messages)
    .values({
      ticketId,
      kind: "note",
      authorId: null,
      authorName: author,
      body,
      createdAt: at,
    });
}

const keyOf = (e, gateway) =>
  `${gateway.id}|${e.deviceId ?? "-"}|${groupOf(e.kind)}`;

// The team chosen for backup alerts (if it still exists)
async function alertTeam() {
  const config = (await setting(SETTING)) ?? {};
  if (!config.departmentId) return null;
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, config.departmentId));
  return d?.id ?? null;
}
registerAlertSource("backup", async () => ({ departmentId: await alertTeam() }));

// The ticket made from an alert, if it's still open: it hears about the
// alert too (a note), and is resolved with it
async function openTicketOf(alert) {
  if (!alert.ticketId) return null;
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, alert.ticketId));
  return ticket && !isDone(ticket.status) ? ticket : null;
}

// Several alerts about the same problem on the same device, sent together
// (all "back to normal", or all not): a new alert, counted on the open
// one, or resolved. (Exported for its tests.)
export async function handleEvent(list, gateway) {
  const e = list.reduce((a, x) => (worse(a.severity, x.severity) === x.severity ? x : a), list[0]);
  const author = `Backup gateway (${gateway.name})`;
  const group = groupOf(e.kind);
  const key = keyOf(e, gateway);
  const alert = await openAlert(key);
  const now = new Date();
  const details = describeAll(list, gateway.name);

  // Back to normal: resolve it (and its ticket)
  if (isRecovery(e)) {
    if (!alert) return "nothing open";
    await db
      .update(alerts)
      .set({ status: "resolved", resolvedAt: now, resolvedById: null, lastSeenAt: now })
      .where(eq(alerts.id, alert.id));
    await addEvent(alert.id, "back to normal", {
      actor: { id: null, name: author },
      body: `Back to normal: ${describe(e, gateway.name)}`,
      at: now,
    });
    const ticket = await openTicketOf(alert);
    if (ticket) {
      await addNote(ticket.id, author, `Back to normal: ${describe(e, gateway.name)}`, now);
      await db
        .update(tickets)
        .set({ status: "resolved", resolvedAt: now, updatedAt: now })
        .where(eq(tickets.id, ticket.id));
      await recordEvent({
        ticket,
        actor: { id: null, name: author },
        type: "status:resolved",
        body: "changed status to Resolved: the problem cleared by itself",
        at: new Date(now.getTime() + 1),
      });
      await afterTicketEvent(ticket.id, "statusChanged", "resolved");
      sendToEveryone("changed", { resource: "tickets", id: ticket.id, customerId: ticket.customerId });
    }
    announceAlert(alert.id);
    return "resolved";
  }

  // The same problem again: counted on the open alert
  if (alert) {
    const severity = worse(alert.severity, e.severity);
    const raised = severity !== alert.severity;
    const [updated] = await db
      .update(alerts)
      .set({
        count: alert.count + list.length,
        lastSeenAt: now,
        severity,
        details,
        ...(raised ? { title: e.title.slice(0, 300) } : {}),
      })
      .where(eq(alerts.id, alert.id))
      .returning();
    await addEvent(alert.id, raised ? "worse" : "again", {
      actor: { id: null, name: author },
      body: raised ? `Now ${severity}: ${details}` : details,
      at: now,
    });
    const ticket = await openTicketOf(updated);
    if (ticket) await addNote(ticket.id, author, details, now);
    // It just became critical: a ticket, and people are told
    if (raised) {
      const departmentId = await alertTeam();
      if (makesTicket(severity) && !ticket) {
        const made = await makeTicket(updated, { departmentId, author });
        updated.ticketId = made.id;
      }
      tell(updated, { departmentId });
    }
    announceAlert(alert.id);
    return "added";
  }

  // Something new: an alert
  const client = await clientRow(gateway.id, gateway.name, e.client ?? "");
  const customer = await customerFor(client);
  const [created] = await db
    .insert(alerts)
    .values({
      source: "backup",
      key,
      kind: group,
      title: e.title.slice(0, 300),
      severity: e.severity,
      status: "open",
      device: e.device,
      customerId: customer.id,
      clientId: client.id,
      count: list.length,
      details,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning();
  await addEvent(created.id, "fired", { actor: { id: null, name: author }, body: details, at: now });
  const departmentId = await alertTeam();
  if (makesTicket(created.severity)) {
    const made = await makeTicket(created, { departmentId, author });
    created.ticketId = made.id;
  }
  tell(created, { departmentId, customerName: customer.name });
  announceAlert(created.id);
  return makesTicket(created.severity) ? "alert and ticket" : "alert";
}

// One request at a time, so two at once can't both make a ticket for the
// same problem
let queue = Promise.resolve();
const oneAtATime = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

// ---------- The webhook (the gateway calls this) ----------

// Mounted in index.js with the raw body (express.raw), which the signature
// is checked against
backupAlertsRouter.post("/webhook", async (req, res) => {
  const config = await setting(SETTING);
  if (!config?.enabled || !config.secret)
    return res.status(404).json({ error: "Backup alerts are turned off." });
  let secret;
  try {
    secret = unseal(config.secret);
  } catch {
    return res
      .status(503)
      .json({ error: "Make a new secret on Integrations → Backup alerts." });
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (
    !signedOk(
      secret,
      req.get("x-gateway-timestamp"),
      req.get("x-gateway-signature"),
      raw,
    )
  )
    return res
      .status(401)
      .json({ error: "Not signed with this helpdesk's secret." });

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Not JSON." });
  }
  if (payload?.source !== "backup-gateway" || !Array.isArray(payload.events))
    return res.status(400).json({ error: "Not a backup gateway alert." });

  const name = str(payload.gateway, 100) || "Backup gateway";
  // Older gateways don't send an ID: their name stands in for it
  const id = /^[A-Za-z0-9_-]{8,64}$/.test(payload.gatewayId ?? "")
    ? payload.gatewayId
    : `name-${crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
  const events = payload.events
    .map(cleanEvent)
    .filter(Boolean)
    .sort((a, b) => a.id - b.id)
    .slice(0, 500);

  const results = await oneAtATime(async () => {
    const done = [];
    const fresh = [];
    for (const e of events) {
      if (e.kind === "notify.test") {
        await saveSetting("backupAlertsStatus", {
          ...((await setting("backupAlertsStatus")) ?? {}),
          lastTestAt: Date.now(),
          gateway: name,
        });
        done.push("test");
        continue;
      }
      // Already handled (the gateway sent it again)
      const added = await db
        .insert(backupEvents)
        .values({ gatewayId: id, eventId: e.id })
        .onConflictDoNothing()
        .returning();
      if (!added.length) done.push("already had it");
      else fresh.push(e);
    }
    // Together: alerts about the same problem on the same device, in the
    // order they happened, split where "back to normal" starts or stops
    const byProblem = new Map(); // key -> [{ recovery, list }]
    for (const e of fresh) {
      const key = keyOf(e, { id });
      const runsOf = byProblem.get(key) ?? [];
      const lastRun = runsOf[runsOf.length - 1];
      if (lastRun && lastRun.recovery === isRecovery(e)) lastRun.list.push(e);
      else runsOf.push({ recovery: isRecovery(e), list: [e] });
      byProblem.set(key, runsOf);
    }
    const runs = [...byProblem.values()].flat();
    for (const run of runs) {
      try {
        done.push(await handleEvent(run.list, { id, name }));
      } catch (err) {
        // Let the gateway try again later
        const ids = run.list.map((e) => e.id);
        await db
          .delete(backupEvents)
          .where(
            and(
              eq(backupEvents.gatewayId, id),
              inArray(backupEvents.eventId, ids),
            ),
          );
        throw err;
      }
    }
    await saveSetting("backupAlertsStatus", {
      ...((await setting("backupAlertsStatus")) ?? {}),
      lastAt: Date.now(),
      gateway: name,
    });
    return done;
  });
  // Forget handled alerts after 30 days
  await db
    .delete(backupEvents)
    .where(sql`${backupEvents.receivedAt} < now() - interval '30 days'`);
  res.json({ ok: true, results });
});

// ---------- Settings (Admins) ----------

backupAlertsRouter.use(requireRole(...ADMINS));

async function view() {
  const config = (await setting(SETTING)) ?? {};
  const status = (await setting("backupAlertsStatus")) ?? {};
  const rows = await db
    .select({ client: backupClients, customer: customers })
    .from(backupClients)
    .leftJoin(customers, eq(backupClients.customerId, customers.id))
    .orderBy(backupClients.gatewayName, backupClients.client);
  const counts = await db
    .select({
      clientId: backupAlerts.clientId,
      open: backupAlerts.open,
      n: count(),
    })
    .from(backupAlerts)
    .innerJoin(tickets, eq(backupAlerts.ticketId, tickets.id))
    .groupBy(backupAlerts.clientId, backupAlerts.open);
  const tally = {};
  for (const c of counts) {
    const t = (tally[c.clientId] ??= { open: 0, total: 0 });
    t.total += c.n;
    if (c.open) t.open += c.n;
  }
  // Alerts on the Alerts page, per client
  const alertCounts = await db
    .select({
      clientId: alerts.clientId,
      open: sql`count(*) filter (where ${alerts.status} <> 'resolved')::int`,
      total: count(),
    })
    .from(alerts)
    .groupBy(alerts.clientId);
  const alertTally = Object.fromEntries(alertCounts.map((c) => [c.clientId, c]));
  return {
    enabled: Boolean(config.enabled),
    hasSecret: Boolean(config.secret),
    departmentId: config.departmentId ?? null,
    lastAt: status.lastAt ?? null,
    lastTestAt: status.lastTestAt ?? null,
    gateway: status.gateway ?? null,
    clients: rows.map(({ client, customer }) => ({
      id: client.id,
      gateway: client.gatewayName,
      client: client.client,
      madeCustomer: client.madeCustomer,
      customer: customer
        ? { id: customer.id, name: customer.name, company: customer.company }
        : null,
      lastSeenAt: client.lastSeenAt.getTime(),
      openAlerts: alertTally[client.id]?.open ?? 0,
      alerts: alertTally[client.id]?.total ?? 0,
      // Tickets made from its alerts before the Alerts page
      tickets: tally[client.id]?.total ?? 0,
    })),
  };
}

backupAlertsRouter.get("/", async (req, res) => {
  res.json(await view());
});

// Turning it on makes the secret the first time (shown once)
backupAlertsRouter.post("/", async (req, res) => {
  const config = (await setting(SETTING)) ?? {};
  const next = { ...config };
  let secret = null;
  if (req.body?.enabled !== undefined) next.enabled = Boolean(req.body.enabled);
  if (req.body?.departmentId !== undefined) {
    const departmentId = req.body.departmentId
      ? String(req.body.departmentId)
      : null;
    if (departmentId) {
      const [d] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, departmentId));
      if (!d) throw new BadInput("That team doesn't exist any more.");
    }
    next.departmentId = departmentId;
  }
  if (next.enabled && !next.secret) {
    secret = newSecret();
    next.secret = seal(secret);
  }
  await saveSetting(SETTING, next);
  res.json({ ...(await view()), ...(secret ? { secret } : {}) });
});

// A new secret: the old one stops working straight away (shown once)
backupAlertsRouter.post("/secret", async (req, res) => {
  const config = (await setting(SETTING)) ?? {};
  const secret = newSecret();
  await saveSetting(SETTING, { ...config, secret: seal(secret) });
  res.json({ ...(await view()), secret });
});

// Which customer a gateway client is. Its backup tickets move to that
// customer; a customer that was only made for these alerts is removed
// once nothing else uses it.
backupAlertsRouter.post("/clients/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(backupClients)
    .where(eq(backupClients.id, Number(req.params.id) || 0));
  if (!row) throw new BadInput("That client isn't on the list any more.", 404);
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, Number(req.body?.customerId) || 0));
  if (!customer) throw new BadInput("Pick a customer.");
  const old = row.customerId;
  if (old === customer.id) return res.json(await view());

  await db.transaction(async (tx) => {
    // Its alerts, and the tickets made from them (now or before the Alerts
    // page), go to the real customer
    await tx
      .update(alerts)
      .set({ customerId: customer.id })
      .where(eq(alerts.clientId, row.id));
    const fromAlerts = await tx
      .select({ id: alerts.ticketId })
      .from(alerts)
      .where(and(eq(alerts.clientId, row.id), sql`${alerts.ticketId} is not null`));
    const mine = (
      await tx
        .select({ id: backupAlerts.ticketId })
        .from(backupAlerts)
        .where(eq(backupAlerts.clientId, row.id))
    ).concat(fromAlerts);
    if (mine.length)
      await tx
        .update(tickets)
        .set({ customerId: customer.id })
        .where(
          inArray(
            tickets.id,
            mine.map((m) => m.id),
          ),
        );
    await tx
      .update(backupClients)
      .set({ customerId: customer.id, madeCustomer: false })
      .where(eq(backupClients.id, row.id));
    // The made-up customer, if nothing else uses it now
    if (old && row.madeCustomer) {
      const [{ n: left }] = await tx
        .select({ n: count() })
        .from(tickets)
        .where(eq(tickets.customerId, old));
      const [{ n: logins }] = await tx
        .select({ n: count() })
        .from(users)
        .where(eq(users.customerId, old));
      const [{ n: others }] = await tx
        .select({ n: count() })
        .from(backupClients)
        .where(
          and(
            eq(backupClients.customerId, old),
            sql`${backupClients.id} <> ${row.id}`,
          ),
        );
      if (!left && !logins && !others)
        await tx.delete(customers).where(eq(customers.id, old));
    }
  });
  sendToEveryone("changed", { resource: "customers", id: customer.id });
  sendToEveryone("changed", { resource: "tickets", id: null });
  announceAlert();
  res.json(await view());
});
