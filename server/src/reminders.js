// The Reminders page: things the team needs reminding of (renew a
// client's domain, check the backups on Friday, pay the ISP...).
// Everyone on the team sees them; only Admins and the Super Admin make,
// change or delete them. When one is due, the people it's for get a
// notification (the bell, and on their phone or computer). A repeating
// one then moves on to its next time; a one-time one is done.
//
//   GET    /api/reminders        all of them, next first
//   POST   /api/reminders        { title, notes, remindAt, allDay, repeat, everyone, userIds, timeZone }
//          (allDay: no time picked; remindAt is then 8:00 AM that day)
//   PATCH  /api/reminders/:id    any of those
//   DELETE /api/reminders/:id
import { Router } from "express";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "./db/index.js";
import { reminders, users } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput, cleanText } from "./validate.js";
import { notify } from "./notify.js";
import { sendToEveryone } from "./live.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
export const REPEATS = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
];

const ms = (d) => (d ? d.getTime() : null);
function shape(r) {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    remindAt: ms(r.remindAt),
    allDay: r.allDay,
    repeat: r.repeat,
    timeZone: r.timeZone,
    everyone: r.everyone,
    userIds: r.userIds,
    createdBy: r.createdByName,
    sentAt: ms(r.sentAt),
    // A one-time reminder that has gone off
    done: r.repeat === "none" && Boolean(r.sentAt) && r.sentAt >= r.remindAt,
  };
}

// The day of the week (0 = Sunday) in that time zone
function weekdayIn(date, timeZone) {
  const name = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone,
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

// The time after `at` for a repeating reminder
function stepOnce(at, repeat, timeZone) {
  const next = new Date(at);
  if (repeat === "daily") return new Date(at.getTime() + DAY);
  if (repeat === "weekly") return new Date(at.getTime() + 7 * DAY);
  if (repeat === "weekdays") {
    let d = new Date(at.getTime() + DAY);
    while ([0, 6].includes(weekdayIn(d, timeZone)))
      d = new Date(d.getTime() + DAY);
    return d;
  }
  if (repeat === "monthly") {
    // The same day each month (the 31st becomes the month's last day)
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next.setUTCDate(Math.min(day, last));
    return next;
  }
  if (repeat === "yearly") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }
  return null;
}

// The next time after now (skipping any missed while the server was off)
export function nextTime(at, repeat, timeZone, now = new Date()) {
  let next = stepOnce(at, repeat, timeZone);
  for (let i = 0; next && next <= now && i < 5000; i++)
    next = stepOnce(next, repeat, timeZone);
  return next;
}

function cleanTimeZone(value) {
  const tz = String(value ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

async function clean(body, { partial = false } = {}) {
  const b = body ?? {};
  const fields = {};
  if (!partial || "title" in b) {
    fields.title = cleanText(b.title, { label: "Title", max: 200 });
    if (!fields.title) throw new BadInput("Give the reminder a title.");
  }
  if (!partial || "notes" in b)
    fields.notes = cleanText(b.notes ?? "", { label: "Notes", max: 2000 });
  if (!partial || "remindAt" in b) {
    const at = new Date(Number(b.remindAt) || b.remindAt);
    if (Number.isNaN(at.getTime())) throw new BadInput("Pick when to remind.");
    fields.remindAt = at;
  }
  if (!partial || "allDay" in b) fields.allDay = b.allDay === true;
  if (!partial || "repeat" in b) {
    fields.repeat = REPEATS.includes(b.repeat) ? b.repeat : "none";
  }
  if (!partial || "timeZone" in b) fields.timeZone = cleanTimeZone(b.timeZone);
  if (!partial || "everyone" in b) fields.everyone = b.everyone !== false;
  if (!partial || "userIds" in b || "everyone" in b) {
    const ids = [
      ...new Set((Array.isArray(b.userIds) ? b.userIds : []).map(String)),
    ].slice(0, 200);
    const found = ids.length
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, ids), inArray(users.role, STAFF)))
      : [];
    fields.userIds = found.map((u) => u.id);
    if (fields.everyone === false && fields.userIds.length === 0)
      throw new BadInput("Pick who to remind, or choose everyone.");
  }
  return fields;
}

async function find(id) {
  const [r] = await db
    .select()
    .from(reminders)
    .where(eq(reminders.id, Number(id) || 0));
  if (!r) throw new BadInput("That reminder doesn't exist.", 404);
  return r;
}

const changed = (id) =>
  sendToEveryone("changed", { resource: "reminders", id });

export const remindersRouter = Router();
remindersRouter.use(requireRole(...STAFF));

remindersRouter.get("/", async (req, res) => {
  const rows = await db
    .select()
    .from(reminders)
    .orderBy(asc(reminders.remindAt));
  res.json(rows.map(shape));
});

const admins = requireRole(...ADMINS);

remindersRouter.post("/", admins, async (req, res) => {
  const fields = await clean(req.body);
  const [row] = await db
    .insert(reminders)
    .values({
      ...fields,
      createdById: req.user.id,
      createdByName: req.user.name ?? "",
    })
    .returning();
  changed(row.id);
  res.status(201).json(shape(row));
});

remindersRouter.patch("/:id", admins, async (req, res) => {
  const current = await find(req.params.id);
  const fields = await clean(req.body, { partial: true });
  // A new time: it goes off again then (also a one-time one that's done)
  if (
    fields.remindAt &&
    fields.remindAt.getTime() !== current.remindAt.getTime()
  )
    fields.sentAt = null;
  const [row] = await db
    .update(reminders)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(reminders.id, current.id))
    .returning();
  changed(row.id);
  res.json(shape(row));
});

remindersRouter.delete("/:id", admins, async (req, res) => {
  const current = await find(req.params.id);
  await db.delete(reminders).where(eq(reminders.id, current.id));
  changed(current.id);
  res.json({ ok: true });
});

// ---------- Going off ----------

// Every minute: reminders whose time has come (and haven't gone off for
// that time yet) notify their people
let checking = false;
export async function sendDueReminders(now = new Date()) {
  if (checking) return;
  checking = true;
  try {
    const due = await db
      .select()
      .from(reminders)
      .where(lte(reminders.remindAt, now));
    for (const r of due) {
      if (r.sentAt && r.sentAt >= r.remindAt) continue; // one-time, done
      // Moved on (or marked) first, so it never goes off twice
      const next =
        r.repeat === "none"
          ? null
          : nextTime(r.remindAt, r.repeat, r.timeZone, now);
      await db
        .update(reminders)
        .set({ sentAt: now, ...(next ? { remindAt: next } : {}) })
        .where(eq(reminders.id, r.id));
      const people = r.everyone
        ? (
            await db
              .select({ id: users.id })
              .from(users)
              .where(
                and(inArray(users.role, STAFF), eq(users.status, "active")),
              )
          ).map((u) => u.id)
        : r.userIds;
      await notify(people, {
        kind: "reminder",
        title: `Reminder: ${r.title}`,
        body: r.notes,
      });
      changed(r.id);
    }
  } finally {
    checking = false;
  }
}

export function startReminders() {
  const run = () =>
    sendDueReminders().catch((err) => console.error("Reminders:", err));
  setTimeout(run, 10 * 1000).unref();
  setInterval(run, MINUTE).unref();
}
