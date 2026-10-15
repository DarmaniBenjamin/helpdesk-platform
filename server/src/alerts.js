// Alerts: problems reported by other systems (today the backup gateway,
// backupAlerts.js), on their own page instead of in the Inbox, so they
// don't take ticket numbers or count in the reports. Everyone on staff
// sees them.
//
//   - One alert per problem, per device: more alerts about the same problem
//     while it's open are counted on it ("again"), and the most serious
//     severity wins.
//   - Open → Acknowledged ("I'm on it", by someone) → Resolved (by someone,
//     or by itself when the system says it's back to normal). A resolved
//     problem that comes back is a new alert.
//   - Critical alerts also make a ticket by themselves (makeTicket);
//     others only with "Make a ticket".
//   - High and critical alerts notify the backup alerts' team (or, without
//     one, everyone on staff): the bell, and phone/desktop notifications.
//
//   GET  /api/alerts                 ?status=open|resolved|all  ?minor=1 (low and info too)
//   GET  /api/alerts/count           open alerts, for the sidebar
//   GET  /api/alerts/:id             with its history
//   POST /api/alerts/:id/acknowledge
//   POST /api/alerts/:id/resolve
//   POST /api/alerts/:id/reopen
//   POST /api/alerts/:id/ticket      make a ticket for it
import { Router } from "express";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  alertEvents,
  alerts,
  backupClients,
  customers,
  departments,
  messages,
  tickets,
  userDepartments,
  users,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";
import { getSla } from "./sla.js";
import { recordEvent } from "./activity.js";
import { afterTicketEvent } from "./automation.js";
import { notify, onTicketCreated } from "./notify.js";
import { sendToEveryone } from "./live.js";

export const alertsRouter = Router();

const HOUR = 60 * 60 * 1000;
export const SEVERITIES = ["info", "low", "medium", "high", "critical"];
// The ticket's priority, for a ticket made from an alert
const PRIORITY = { critical: 4, high: 3, medium: 2, low: 1, info: 1 };

// ---------- Rules (also tested on their own) ----------

// The more serious of two severities
export const worse = (a, b) =>
  SEVERITIES.indexOf(b) > SEVERITIES.indexOf(a) ? b : a;
// High and critical alerts notify people
export const notifies = (severity) => severity === "high" || severity === "critical";
// Critical alerts make a ticket by themselves
export const makesTicket = (severity) => severity === "critical";
export const isOpen = (status) => status === "open" || status === "acknowledged";

// ---------- Changes, and telling every open tab ----------

export function announce(id = null) {
  sendToEveryone("changed", { resource: "alerts", id });
}

export async function addEvent(alertId, type, { actor = null, body = "", at = new Date() } = {}) {
  await db.insert(alertEvents).values({
    alertId,
    type,
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? "",
    body: body.slice(0, 4000),
    createdAt: at,
  });
}

// The open alert for a problem, if there is one
export async function openAlert(key) {
  const [row] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.key, key), inArray(alerts.status, ["open", "acknowledged"])))
    .orderBy(desc(alerts.id))
    .limit(1);
  return row ?? null;
}

// Who hears about a serious alert: the team chosen for backup alerts, or
// everyone on staff
async function whoToTell(departmentId) {
  if (departmentId) {
    const rows = await db
      .select({ id: users.id })
      .from(userDepartments)
      .innerJoin(users, eq(userDepartments.userId, users.id))
      .where(and(eq(userDepartments.departmentId, departmentId), eq(users.status, "active")));
    if (rows.length) return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, STAFF), eq(users.status, "active")));
  return rows.map((r) => r.id);
}

export function tell(alert, { departmentId = null, customerName = "" } = {}) {
  if (!notifies(alert.severity)) return;
  (async () => {
    const people = await whoToTell(departmentId);
    await notify(people, {
      kind: "alert",
      title: `${alert.severity === "critical" ? "Critical" : "High"} alert: ${alert.title}`.slice(0, 200),
      body: [alert.device, customerName].filter(Boolean).join(" · "),
      ticketId: alert.ticketId ?? null,
    });
  })().catch((err) => console.error("Alert notification failed:", err));
}

// ---------- Making a ticket from an alert ----------

// A ticket for the alert's customer, with its details, linked to it.
// actor: who pressed "Make a ticket" (null: a critical alert, by itself)
export async function makeTicket(alert, { actor = null, departmentId = null, author = "Alerts" } = {}) {
  if (alert.ticketId) {
    const [existing] = await db.select().from(tickets).where(eq(tickets.id, alert.ticketId));
    if (existing && existing.status !== "resolved" && existing.status !== "closed") return existing;
  }
  let customerId = alert.customerId;
  if (!customerId) throw new BadInput("This alert isn't linked to a customer, so there's no one to make the ticket for.");
  if (departmentId) {
    const [d] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId));
    if (!d) departmentId = null; // that team was deleted
  }
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) throw new BadInput("The alert's customer doesn't exist any more.");
  const priority = PRIORITY[alert.severity] ?? 2;
  const sla = await getSla();
  const now = new Date();
  const [ticket] = await db
    .insert(tickets)
    .values({
      subject: alert.title.slice(0, 200),
      description: alert.details || alert.title,
      status: "open",
      priority,
      departmentId,
      customerId,
      source: alert.source,
      tags: [alert.source, alert.kind].filter(Boolean).slice(0, 20),
      firstResponseDue: new Date(now.getTime() + sla[priority].firstResponse * HOUR),
      dueBy: new Date(now.getTime() + sla[priority].resolve * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db.insert(messages).values({
    ticketId: ticket.id,
    kind: "note",
    authorId: null,
    authorName: author,
    body: `${alert.details || alert.title}\n\n(Alert #${alert.id} on the Alerts page, seen ${alert.count} time${alert.count === 1 ? "" : "s"}.)`,
    createdAt: now,
  });
  await recordEvent({
    ticket,
    actor: actor ? { id: actor.id, name: actor.name } : { id: null, name: author },
    type: "created",
    body: actor ? `made this ticket from alert #${alert.id}` : `made this ticket from critical alert #${alert.id}`,
    at: new Date(now.getTime() + 1),
  });
  await db.update(alerts).set({ ticketId: ticket.id }).where(eq(alerts.id, alert.id));
  await addEvent(alert.id, "ticket", {
    actor,
    body: actor ? `Made ticket #${ticket.id}.` : `Critical: made ticket #${ticket.id} by itself.`,
  });
  // Assignment rules, automations, and the Admins' "New ticket" notification
  await afterTicketEvent(ticket.id, "created");
  onTicketCreated(ticket, customer.name, { id: actor?.id ?? null });
  sendToEveryone("changed", { resource: "tickets", id: ticket.id, customerId });
  announce(alert.id);
  return ticket;
}

// ---------- The Alerts page (everyone on staff) ----------

alertsRouter.use(requireRole(...STAFF));

const ms = (d) => d?.getTime() ?? null;

async function load(where, limit = 300) {
  const rows = await db
    .select({ alert: alerts, customer: customers.name, client: backupClients.client })
    .from(alerts)
    .leftJoin(customers, eq(alerts.customerId, customers.id))
    .leftJoin(backupClients, eq(alerts.clientId, backupClients.id))
    .where(where)
    .orderBy(desc(alerts.lastSeenAt))
    .limit(limit);
  const people = new Map(
    (
      await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          inArray(
            users.id,
            [...new Set(rows.flatMap((r) => [r.alert.acknowledgedById, r.alert.resolvedById]).filter(Boolean))].concat(["-"]),
          ),
        )
    ).map((u) => [u.id, u.name]),
  );
  return rows.map(({ alert: a, customer, client }) => ({
    id: a.id,
    source: a.source,
    kind: a.kind,
    title: a.title,
    severity: a.severity,
    status: a.status,
    device: a.device,
    customerId: a.customerId,
    customer: customer ?? client ?? null,
    ticketId: a.ticketId,
    count: a.count,
    details: a.details,
    acknowledgedBy: people.get(a.acknowledgedById) ?? null,
    acknowledgedAt: ms(a.acknowledgedAt),
    resolvedBy: a.resolvedAt ? (people.get(a.resolvedById) ?? null) : null,
    resolvedAt: ms(a.resolvedAt),
    firstSeenAt: ms(a.firstSeenAt),
    lastSeenAt: ms(a.lastSeenAt),
  }));
}

alertsRouter.get("/", async (req, res) => {
  const status = String(req.query.status ?? "open");
  const conditions = [];
  if (status === "open") conditions.push(inArray(alerts.status, ["open", "acknowledged"]));
  else if (status === "resolved") conditions.push(eq(alerts.status, "resolved"));
  if (req.query.minor !== "1") conditions.push(inArray(alerts.severity, ["medium", "high", "critical"]));
  const customerId = Number(req.query.customerId) || 0;
  if (customerId) conditions.push(eq(alerts.customerId, customerId));
  res.json(await load(conditions.length ? and(...conditions) : undefined));
});

alertsRouter.get("/count", async (req, res) => {
  const [row] = await db
    .select({
      open: sql`count(*) filter (where ${alerts.severity} in ('medium', 'high', 'critical'))::int`,
      critical: sql`count(*) filter (where ${alerts.severity} = 'critical')::int`,
    })
    .from(alerts)
    .where(eq(alerts.status, "open"));
  res.json({ open: row?.open ?? 0, critical: row?.critical ?? 0 });
});

async function one(id) {
  const [alert] = await load(eq(alerts.id, Number(id) || 0), 1);
  if (!alert) throw new BadInput("That alert doesn't exist.", 404);
  alert.events = (
    await db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.alertId, alert.id))
      .orderBy(desc(alertEvents.createdAt), desc(alertEvents.id))
      .limit(200)
  ).map((e) => ({ id: e.id, type: e.type, actor: e.actorName || null, body: e.body, at: e.createdAt.getTime() }));
  return alert;
}

alertsRouter.get("/:id", async (req, res) => {
  res.json(await one(req.params.id));
});

async function change(req, from, set, type, body) {
  const [alert] = await db.select().from(alerts).where(eq(alerts.id, Number(req.params.id) || 0));
  if (!alert) throw new BadInput("That alert doesn't exist.", 404);
  if (!from.includes(alert.status)) return alert; // already done (two people at once)
  await db.update(alerts).set(set).where(eq(alerts.id, alert.id));
  await addEvent(alert.id, type, { actor: req.user, body });
  announce(alert.id);
  return alert;
}

alertsRouter.post("/:id/acknowledge", async (req, res) => {
  await change(
    req,
    ["open"],
    { status: "acknowledged", acknowledgedById: req.user.id, acknowledgedAt: new Date() },
    "acknowledged",
    "On it.",
  );
  res.json(await one(req.params.id));
});

alertsRouter.post("/:id/resolve", async (req, res) => {
  await change(
    req,
    ["open", "acknowledged"],
    { status: "resolved", resolvedById: req.user.id, resolvedAt: new Date() },
    "resolved",
    String(req.body?.note ?? "").trim().slice(0, 1000) || "Resolved.",
  );
  res.json(await one(req.params.id));
});

alertsRouter.post("/:id/reopen", async (req, res) => {
  const [alert] = await db.select().from(alerts).where(eq(alerts.id, Number(req.params.id) || 0));
  if (!alert) throw new BadInput("That alert doesn't exist.", 404);
  // Only if the same problem hasn't come back as a new alert since
  const [newer] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.key, alert.key), inArray(alerts.status, ["open", "acknowledged"]), ne(alerts.id, alert.id)));
  if (newer) throw new BadInput(`This problem came back as alert #${newer.id}: that's the open one.`);
  await change(
    req,
    ["resolved"],
    { status: "open", resolvedById: null, resolvedAt: null, acknowledgedById: null, acknowledgedAt: null },
    "reopened",
    "Opened again.",
  );
  res.json(await one(req.params.id));
});

alertsRouter.post("/:id/ticket", async (req, res) => {
  const [alert] = await db.select().from(alerts).where(eq(alerts.id, Number(req.params.id) || 0));
  if (!alert) throw new BadInput("That alert doesn't exist.", 404);
  const { departmentId } = (await alertSettingsFor(alert.source)) ?? {};
  const ticket = await makeTicket(alert, { actor: req.user, departmentId });
  res.json({ ...(await one(req.params.id)), ticketId: ticket.id });
});

// The settings of the system an alert came from (which team its tickets
// go to): set by backupAlerts.js
const settingsFor = new Map();
export function registerAlertSource(source, loadSettings) {
  settingsFor.set(source, loadSettings);
}
async function alertSettingsFor(source) {
  return (await settingsFor.get(source)?.()) ?? {};
}
