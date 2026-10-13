// Maintenance, stage 1: noticing what goes wrong. Every error the app
// runs into is recorded as an incident (Maintenance page, Admins), with
// repeats of the same error counted on one incident instead of making new
// ones (incidentRules.js decides what counts as "the same").
//
// What's caught:
//   - errors in API requests that end in a 500 (index.js's last handler)
//   - crashes: uncaught exceptions and unhandled promise rejections. The
//     app still stops afterwards, like before, and systemd starts it again
//   - errors in the background work (email checks, backups, jobs...):
//     anything they log with console.error that has an Error in it
//   - database errors (from any of those)
//   - the database health check failing (checked every minute)
//   - a sudden rise in server errors (20+ in 5 minutes)
//   - errors in people's browsers, and bugs staff report (the routes below)
//
// Safe by design:
//   - secrets and personal details are taken out before anything is
//     stored or logged (incidentRules.js redact())
//   - nothing is written to the database straight away: errors are
//     counted in memory and saved every 10 seconds, so an error that
//     happens 1,000 times a second is one write, not 1,000
//   - at most 30 new kinds of error an hour, and 200 waiting at once: an
//     error loop can't fill the database or (later) run up AI costs
//   - if the database is down, errors wait in memory and are saved when
//     it's back; recording an error can never itself crash the app
//   - every error is also logged as one JSON line (journalctl -u helpdesk)
//
//   POST /api/incidents/browser     an error in someone's browser (signed in)
//   POST /api/incidents/report      "Report a bug" (staff)
//   GET  /api/incidents             the list (Admins); ?all=1 includes finished ones
//   GET  /api/incidents/:id         one, with its history (Admins)
//   POST /api/incidents/:id/dismiss { reason }  not a real problem (Admins)
//   POST /api/incidents/:id/reopen  (Admins)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, pool } from "./db/index.js";
import { incidentEvents, incidents, users } from "./db/schema.js";
import { requireAuth, requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";
import {
  categorize,
  cleanStack,
  fingerprint,
  redact,
  titleFor,
  triage,
} from "./incidentRules.js";

export const incidentsRouter = Router();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const FLUSH_EVERY = 10 * SECOND;
const MAX_WAITING = 200; // kinds of error waiting to be saved
const NEW_PER_HOUR = 30; // new kinds of error recorded per hour
const SPIKE = 20; // server errors in 5 minutes that count as a spike
const CAPTURED = Symbol("captured");
// Finished incidents: one that happens again after these is reopened
const FIXED = ["deployed", "verified"];
// Not shown in the list unless asked for
const DONE = ["verified", "dismissed", "rejected"];

// console.error as it was before installErrorCapture() wrapped it
const log = console.error.bind(console);

// ---------- Which version of the app is running ----------

function readVersion() {
  try {
    const git = path.resolve(import.meta.dirname, "../../.git");
    const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 12);
    const ref = head.slice(5).trim();
    const file = path.join(git, ref);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim().slice(0, 12);
    const packed = fs.readFileSync(path.join(git, "packed-refs"), "utf8");
    return packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.slice(0, 12) ?? "unknown";
  } catch {
    return "unknown";
  }
}
export const APP_VERSION = readVersion();

// ---------- Recording an error ----------

// Kinds of error waiting to be saved: fingerprint -> details and count
const waiting = new Map();
// Fingerprints already saved by this run of the app
const known = new Set();
let newThisHour = 0;
let hourStarted = Date.now();
let floodNoted = false;
let busy = false; // stops recording an error from recording itself

// The part of the app it happened in, from the first of its own files in
// the stack: server/src/email.js -> "email"
function componentFromStack(stack) {
  const m = String(stack ?? "").match(/(?:server\/)?src\/([\w/-]+)\.jsx?:\d+/);
  return m ? m[1].replace(/\//g, ".") : null;
}

// Only these details are kept with an incident, each redacted and short
const CONTEXT_KEYS = [
  "method",
  "route",
  "status",
  "userRole",
  "page",
  "browser",
  "kind",
  "note",
  "count",
];
function cleanContext(context = {}) {
  const out = {};
  for (const key of CONTEXT_KEYS)
    if (context[key] !== undefined && context[key] !== null && context[key] !== "")
      out[key] = redact(String(context[key]), 200);
  out.appVersion = APP_VERSION;
  out.node = process.version;
  return out;
}

// Records one error. err: an Error (or anything thrown). ctx: { source,
// component, category, requestId, userId, context, title, description,
// quiet }. Never throws.
export function capture(err, ctx = {}) {
  if (busy) return;
  busy = true;
  try {
    const e =
      err instanceof Error
        ? err
        : Object.assign(new Error(typeof err === "string" ? err : safeString(err)), {
            stack: "",
          });
    if (e[CAPTURED]) return;
    try {
      e[CAPTURED] = true;
    } catch {
      // a frozen error: fine
    }

    const source = ctx.source ?? "server";
    const component = ctx.component ?? componentFromStack(e.stack) ?? "server";
    const category = ctx.category ?? categorize(e);
    const prefix = e.name && e.name !== "Error" ? `${e.name}: ` : "";
    const message = redact(`${prefix}${e.message ?? ""}`, 1000);
    const print =
      ctx.fingerprint ??
      fingerprint({ component, category, message: e.message, stack: e.stack });

    if (!ctx.quiet)
      log(
        JSON.stringify({
          level: "error",
          at: new Date().toISOString(),
          incident: print,
          component,
          category,
          requestId: ctx.requestId ?? null,
          message,
        }),
      );

    const now = new Date();
    const already = waiting.get(print);
    if (already) {
      already.count += 1;
      already.lastSeen = now;
      if (ctx.requestId) already.lastRequestId = ctx.requestId;
      return;
    }
    if (waiting.size >= MAX_WAITING) return;
    if (!known.has(print)) {
      if (Date.now() - hourStarted > HOUR) {
        hourStarted = Date.now();
        newThisHour = 0;
        floodNoted = false;
      }
      if (newThisHour >= NEW_PER_HOUR) {
        if (!floodNoted) {
          floodNoted = true;
          log(
            JSON.stringify({
              level: "warn",
              message: `More than ${NEW_PER_HOUR} new kinds of error this hour: the rest are only logged, not recorded.`,
            }),
          );
        }
        return;
      }
      newThisHour += 1;
    }
    waiting.set(print, {
      fingerprint: print,
      source,
      component: redact(component, 60),
      category,
      title: ctx.title ? redact(ctx.title, 200) : titleFor({ component, category, message }),
      message,
      stack: cleanStack(e.stack),
      description: redact(ctx.description ?? "", 5000),
      context: cleanContext(ctx.context),
      reportedById: ctx.userId ?? null,
      lastRequestId: ctx.requestId ?? null,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });
  } catch (failed) {
    log("Couldn't record an error:", failed?.message);
  } finally {
    busy = false;
  }
}

function safeString(value) {
  try {
    return JSON.stringify(value)?.slice(0, 500) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------- The history of an incident ----------

export async function addIncidentEvent(incidentId, type, { actor, body = "", data = {} } = {}) {
  await db.insert(incidentEvents).values({
    incidentId,
    type,
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? "",
    body: redact(body, 5000),
    data,
  });
}

// ---------- Saving to the database ----------

// Saves one waiting error: a new incident, or adds to the one it repeats
async function save(item) {
  const [old] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.fingerprint, item.fingerprint));
  if (!old) {
    const { severity, investigate } = triage(item);
    const [made] = await db
      .insert(incidents)
      .values({ ...item, severity, investigate })
      .onConflictDoNothing()
      .returning({ id: incidents.id });
    if (made)
      await addIncidentEvent(made.id, "detected", {
        actor: item.reportedById ? { id: item.reportedById } : null,
        body:
          item.source === "user"
            ? "Reported by a member of the team."
            : `First seen (${item.count} time${item.count === 1 ? "" : "s"}).`,
      });
    return;
  }
  const count = old.count + item.count;
  const { severity, investigate } = triage({ ...old, count });
  const cameBack = FIXED.includes(old.status);
  await db
    .update(incidents)
    .set({
      count,
      lastSeen: item.lastSeen,
      lastRequestId: item.lastRequestId ?? old.lastRequestId,
      // Severity and "worth investigating" only ever go up
      severity: rank(severity) > rank(old.severity) ? severity : old.severity,
      investigate: old.investigate || investigate,
      ...(cameBack ? { status: "detected" } : {}),
    })
    .where(eq(incidents.id, old.id));
  if (cameBack)
    await addIncidentEvent(old.id, "recurred", {
      body: `Happened again after it was marked ${old.status.replace("_", " ")}: reopened.`,
    });
}

const RANKS = ["low", "medium", "high", "critical"];
const rank = (severity) => RANKS.indexOf(severity);

let flushing = false;
let dbDownNoted = false;
export async function flushIncidents() {
  if (flushing || !waiting.size) return;
  flushing = true;
  try {
    for (const [print, item] of [...waiting]) {
      try {
        await save(item);
        waiting.delete(print);
        known.add(print);
        dbDownNoted = false;
      } catch (err) {
        // The database is probably down: keep it, try again next time
        if (!dbDownNoted) {
          dbDownNoted = true;
          log(
            JSON.stringify({
              level: "warn",
              message: `Couldn't save incidents (${redact(err.message, 200)}). They're kept in memory and saved when the database is back.`,
            }),
          );
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

// ---------- Hooks into the app ----------

// Each request gets an ID (or keeps the one it came with), sent back in
// the X-Request-Id header and kept with any error it causes, so an error
// can be matched to a request in the logs
export function requestIds(req, res, next) {
  const given = String(req.get("x-request-id") ?? "");
  req.id = /^[A-Za-z0-9-]{8,64}$/.test(given) ? given : crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
}

// For index.js's last error handler: an API request that failed with a
// 500. The route is its pattern (/api/tickets/:id), never the real
// address, which can have tokens in it.
export function captureRequestError(err, req) {
  const component = (req.baseUrl || "/api").replace(/^\/api\/?/, "") || "api";
  capture(err, {
    source: "server",
    component: `api.${component.replace(/\//g, ".")}`,
    requestId: req.id,
    context: {
      method: req.method,
      route: `${req.baseUrl ?? ""}${req.route?.path ?? ""}` || "(unknown)",
      status: 500,
      userRole: req.user?.role ?? "signed out",
    },
  });
}

// Counts server errors, to notice a sudden rise
const serverErrors = [];
export function countServerErrors(req, res, next) {
  res.on("finish", () => {
    if (res.statusCode >= 500) serverErrors.push(Date.now());
  });
  next();
}

let spikeNotedAt = 0;
function checkForSpike() {
  const since = Date.now() - 5 * MINUTE;
  while (serverErrors.length && serverErrors[0] < since) serverErrors.shift();
  if (serverErrors.length >= SPIKE && Date.now() - spikeNotedAt > 30 * MINUTE) {
    spikeNotedAt = Date.now();
    capture(new Error(`Many server errors: ${serverErrors.length} in 5 minutes`), {
      source: "spike",
      component: "api",
      category: "runtime",
      fingerprint: "spike:server-errors",
      context: { count: serverErrors.length },
    });
  }
}

async function checkHealth() {
  try {
    await Promise.race([
      pool.query("select 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("no answer in 10 seconds")), 10 * SECOND),
      ),
    ]);
  } catch (err) {
    capture(new Error(`Database health check failed: ${err.message}`), {
      source: "health",
      component: "health",
      category: "database",
      fingerprint: "health:database",
    });
  }
}

// ---------- Verified fixes ----------

// A deployed fix (deploy/update.sh marks them) whose error hasn't
// happened again for 7 days (MAINT_VERIFY_DAYS) is verified. If it does
// happen again, save() above opens the incident again instead.
const VERIFY_DAYS = Number(process.env.MAINT_VERIFY_DAYS) || 7;
export async function verifyFixes(now = Date.now()) {
  const live = await db.select().from(incidents).where(eq(incidents.status, "deployed"));
  for (const incident of live) {
    const at = Date.parse(incident.github?.deployedAt ?? "");
    if (!at || now - at < VERIFY_DAYS * 24 * HOUR) continue;
    if (incident.lastSeen.getTime() > at) continue;
    await db.update(incidents).set({ status: "verified" }).where(eq(incidents.id, incident.id));
    await addIncidentEvent(incident.id, "verified", {
      body:
        incident.source === "user"
          ? `Verified by time: live for ${VERIFY_DAYS} days (a reported bug can't be seen happening again: check with whoever reported it).`
          : `Verified: the error hasn't happened in the ${VERIFY_DAYS} days since the fix went live.`,
    });
  }
}

// After a crash: save what was caught (for up to 3 seconds), then stop,
// as before; systemd starts the app again
let stopping = false;
function stopAfterCrash() {
  if (stopping) return;
  stopping = true;
  Promise.race([flushIncidents(), new Promise((r) => setTimeout(r, 3 * SECOND))]).finally(
    () => process.exit(1),
  );
}

let installed = false;
export function installErrorCapture() {
  if (installed) return;
  installed = true;

  // Background work logs its errors with console.error: those with an
  // Error in them are recorded too
  console.error = (...args) => {
    log(...args);
    const err = args.find((a) => a instanceof Error);
    if (err && !err[CAPTURED])
      capture(err, {
        quiet: true,
        context: { note: typeof args[0] === "string" ? args[0] : "" },
      });
  };

  process.on("uncaughtException", (err) => {
    log(err);
    capture(err, { source: "crash", quiet: true, context: { kind: "uncaught exception" } });
    stopAfterCrash();
  });
  process.on("unhandledRejection", (reason) => {
    log(reason);
    capture(reason, {
      source: "crash",
      quiet: true,
      context: { kind: "unhandled promise rejection" },
    });
    stopAfterCrash();
  });

  setInterval(() => flushIncidents().catch(() => {}), FLUSH_EVERY).unref();
  setInterval(checkForSpike, MINUTE).unref();
  setInterval(checkHealth, MINUTE).unref();
  setInterval(() => verifyFixes().catch(() => {}), HOUR).unref();
}

// ---------- From people's browsers ----------

// At most 20 browser errors per person per 10 minutes
const sent = new Map();
function tooMany(userId) {
  const now = Date.now();
  const times = (sent.get(userId) ?? []).filter((t) => now - t < 10 * MINUTE);
  times.push(now);
  sent.set(userId, times);
  if (sent.size > 5000) sent.clear();
  return times.length > 20;
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

incidentsRouter.post("/browser", requireAuth, (req, res) => {
  if (tooMany(req.user.id)) return res.status(202).json({ ok: true });
  const b = req.body ?? {};
  const message = text(b.message, 1000);
  if (!message) throw new BadInput("No error message.");
  const err = new Error(message);
  err.name = text(b.name, 60) || "Error";
  err.stack = text(b.stack, 8000);
  capture(err, {
    source: "browser",
    component: `browser.${(text(b.page, 200).split("/")[1] || "home").replace(/[^\w-]/g, "")}`,
    category: categorize(err),
    requestId: req.id,
    context: {
      kind: text(b.kind, 40) || "runtime",
      // The page's pattern only: /tickets/123 -> /tickets/<n>
      page: text(b.page, 200).split("?")[0].replace(/\/\d+(?=\/|$)/g, "/<n>"),
      browser: text(req.get("user-agent"), 200).replace(/\s*\(.*?\)\s*/g, " "),
      userRole: req.user.role,
    },
  });
  res.status(202).json({ ok: true });
});

// ---------- "Report a bug" (staff) ----------

incidentsRouter.post("/report", requireRole(...STAFF), async (req, res) => {
  const title = text(req.body?.title, 200).trim();
  const description = text(req.body?.description, 5000).trim();
  const page = text(req.body?.page, 200).split("?")[0];
  if (title.length < 5) throw new BadInput("Say in a few words what went wrong.");
  if (description.length < 10)
    throw new BadInput("Describe what happened, and what you expected to happen.");
  const { severity, investigate } = triage({ source: "user", category: "runtime" });
  const [made] = await db
    .insert(incidents)
    .values({
      // Each report is its own incident
      fingerprint: `user:${crypto.randomUUID()}`,
      source: "user",
      component: `report.${(page.split("/")[1] || "home").replace(/[^\w-]/g, "")}`,
      category: "reported",
      title: redact(title, 200),
      description: redact(description, 5000),
      context: cleanContext({ page, userRole: req.user.role }),
      reportedById: req.user.id,
      lastRequestId: req.id,
      severity,
      investigate,
    })
    .returning({ id: incidents.id });
  await addIncidentEvent(made.id, "detected", {
    actor: req.user,
    body: "Reported a bug.",
  });
  res.status(201).json({ id: made.id });
});

// ---------- The Maintenance page (Admins) ----------

incidentsRouter.use(requireRole(...ADMINS));

const listed = (i) => ({
  id: i.id,
  status: i.status,
  severity: i.severity,
  source: i.source,
  component: i.component,
  category: i.category,
  title: i.title,
  count: i.count,
  investigate: i.investigate,
  github: i.github,
  firstSeen: i.firstSeen.getTime(),
  lastSeen: i.lastSeen.getTime(),
});

incidentsRouter.get("/", async (req, res) => {
  const rows = await db
    .select()
    .from(incidents)
    .where(req.query.all ? undefined : notInArray(incidents.status, DONE))
    .orderBy(desc(incidents.lastSeen))
    .limit(300);
  res.json({ incidents: rows.map(listed) });
});

async function getIncident(id) {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, Number(id) || 0));
  if (!incident) throw new BadInput("That incident doesn't exist.", 404);
  return incident;
}

async function full(id) {
  const incident = await getIncident(id);
  const events = await db
    .select({ event: incidentEvents, name: users.name })
    .from(incidentEvents)
    .leftJoin(users, eq(incidentEvents.actorId, users.id))
    .where(eq(incidentEvents.incidentId, incident.id))
    .orderBy(incidentEvents.createdAt);
  const [reporter] = incident.reportedById
    ? await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, incident.reportedById))
    : [];
  return {
    ...listed(incident),
    message: incident.message,
    stack: incident.stack,
    description: incident.description,
    context: incident.context,
    lastRequestId: incident.lastRequestId,
    reportedBy: reporter?.name ?? null,
    investigation: incident.investigation,
    events: events.map(({ event, name }) => ({
      id: event.id,
      type: event.type,
      actor: name ?? (event.actorName || null),
      body: event.body,
      data: event.data,
      at: event.createdAt.getTime(),
    })),
  };
}

incidentsRouter.get("/:id", async (req, res) => {
  res.json(await full(req.params.id));
});

incidentsRouter.post("/:id/dismiss", async (req, res) => {
  const incident = await getIncident(req.params.id);
  const reason = text(req.body?.reason, 500).trim();
  await db
    .update(incidents)
    .set({ status: "dismissed" })
    .where(and(eq(incidents.id, incident.id)));
  await addIncidentEvent(incident.id, "dismissed", {
    actor: req.user,
    body: reason || "Not a real problem.",
  });
  res.json(await full(incident.id));
});

incidentsRouter.post("/:id/reopen", async (req, res) => {
  const incident = await getIncident(req.params.id);
  await db
    .update(incidents)
    .set({ status: "detected" })
    .where(eq(incidents.id, incident.id));
  await addIncidentEvent(incident.id, "reopened", { actor: req.user });
  res.json(await full(incident.id));
});
