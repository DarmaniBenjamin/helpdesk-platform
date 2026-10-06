// The calendar: jobs booked for a time (a site visit, a remote session or
// a call), each done by one or more agents, usually for a ticket.
//
//   GET    /api/jobs?from=&to=      jobs in a time range (ms), for the calendar
//   GET    /api/jobs?ticketId=      a ticket's jobs (the ticket page)
//   POST   /api/jobs                book one
//   PATCH  /api/jobs/:id            change it (time, agents, done...)
//   DELETE /api/jobs/:id            remove it
//   GET    /api/jobs/now            my jobs whose time has come, not answered
//   POST   /api/jobs/:id/ack        answer it: { snooze } minutes, or done
//
// Everyone on the team sees every job (so they can see who's free).
// Admins can change any job; agents can change the jobs they're on or
// booked themselves, and book jobs for anyone.
//
// Notifications (the bell, and phone/desktop pop-ups), only to the agents
// on the job: when you're put on it, when its time changes, 15 minutes
// before it starts, and when it starts. That last one keeps going off
// (every 2 minutes, up to 5 times) until you answer it on your phone:
// the app shows a full-screen "It's time" with I'm here / Snooze /
// Dismiss, and asks to save the customer's location if they have none.
import { Router } from "express";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./db/index.js";
import { customers, jobAgents, jobs, tickets, users } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput, cleanText } from "./validate.js";
import { notify } from "./notify.js";

export const jobsRouter = Router();
jobsRouter.use(requireRole(...STAFF));

const MINUTE = 60 * 1000;
const KINDS = ["onsite", "remote", "call"];
const KIND_WORDS = { onsite: "On site", remote: "Remote", call: "Call" };

// ---------- Shaping and checking ----------

async function shapeJobs(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.job.id);
  const agents = await db
    .select({ jobId: jobAgents.jobId, userId: jobAgents.userId })
    .from(jobAgents)
    .where(inArray(jobAgents.jobId, ids));
  const byJob = {};
  for (const a of agents) (byJob[a.jobId] ??= []).push(a.userId);
  return rows.map(({ job: j, customerName, ticketSubject, place }) => ({
    id: j.id,
    title: j.title,
    kind: j.kind,
    start: j.startsAt.getTime(),
    end: j.endsAt.getTime(),
    location: j.location,
    notes: j.notes,
    ticketId: j.ticketId,
    ticketSubject: ticketSubject ?? null,
    customerId: j.customerId,
    customerName: customerName ?? null,
    // The customer's saved location, if any (to navigate there)
    place:
      place?.lat != null && place?.lng != null
        ? { lat: place.lat, lng: place.lng, note: place.note ?? "" }
        : null,
    done: Boolean(j.doneAt),
    agents: byJob[j.id] ?? [],
    createdById: j.createdById,
  }));
}

function selectJobs() {
  return db
    .select({
      job: jobs,
      customerName: customers.name,
      ticketSubject: tickets.subject,
      place: {
        lat: customers.latitude,
        lng: customers.longitude,
        note: customers.locationNote,
      },
    })
    .from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(tickets, eq(jobs.ticketId, tickets.id));
}

async function loadJob(id) {
  const [row] = await selectJobs().where(eq(jobs.id, Number(id) || 0));
  if (!row) throw new BadInput("That job isn't there anymore.", 404);
  return (await shapeJobs([row]))[0];
}

// The agents: active staff only, no repeats, at least one
async function cleanAgents(value) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(String))];
  if (!ids.length) throw new BadInput("Pick at least one agent for the job.");
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, ids),
        inArray(users.role, STAFF),
        eq(users.status, "active"),
      ),
    );
  if (found.length !== ids.length)
    throw new BadInput("Someone picked isn't on the team anymore.");
  return ids;
}

function cleanTimes(start, end) {
  const s = new Date(Number(start));
  const e = new Date(Number(end));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()))
    throw new BadInput("Pick a start and end time.");
  if (e <= s) throw new BadInput("The job has to end after it starts.");
  if (e - s > 14 * 24 * 60 * MINUTE)
    throw new BadInput("A job can be at most two weeks long.");
  return { startsAt: s, endsAt: e };
}

// Can this person change this job?
function mayChange(user, job) {
  return (
    ADMINS.includes(user.role) ||
    job.agents.includes(user.id) ||
    job.createdById === user.id
  );
}

const when = (ms) =>
  new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: process.env.TIMEZONE || "America/Grenada",
  });

// ---------- The routes ----------

// My jobs whose time has come (or is a minute away) that I haven't
// answered yet: the app shows these full screen
jobsRouter.get("/now", async (req, res) => {
  const now = Date.now();
  const mine = await db
    .select({ jobId: jobAgents.jobId })
    .from(jobAgents)
    .innerJoin(jobs, eq(jobAgents.jobId, jobs.id))
    .where(
      and(
        eq(jobAgents.userId, req.user.id),
        isNull(jobAgents.ackAt),
        isNull(jobs.doneAt),
        lte(jobs.startsAt, new Date(now + MINUTE)),
        gt(jobs.endsAt, new Date(now)),
      ),
    );
  if (!mine.length) return res.json([]);
  const rows = await selectJobs()
    .where(
      inArray(
        jobs.id,
        mine.map((m) => m.jobId),
      ),
    )
    .orderBy(asc(jobs.startsAt));
  res.json(await shapeJobs(rows));
});

jobsRouter.get("/", async (req, res) => {
  if (req.query.ticketId) {
    const rows = await selectJobs()
      .where(eq(jobs.ticketId, Number(req.query.ticketId) || 0))
      .orderBy(asc(jobs.startsAt));
    return res.json(await shapeJobs(rows));
  }
  const from = new Date(Number(req.query.from));
  const to = new Date(Number(req.query.to));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
    throw new BadInput("Give the time range to show.");
  if (to - from > 62 * 24 * 60 * MINUTE)
    throw new BadInput("Show at most two months at a time.");
  // Anything overlapping the range (starts before its end, ends after
  // its start)
  const rows = await selectJobs()
    .where(and(lt(jobs.startsAt, to), gt(jobs.endsAt, from)))
    .orderBy(asc(jobs.startsAt));
  res.json(await shapeJobs(rows));
});

jobsRouter.post("/", async (req, res) => {
  const b = req.body ?? {};
  const title = cleanText(b.title, {
    label: "Title",
    required: true,
    max: 200,
  });
  const kind = KINDS.includes(b.kind) ? b.kind : "onsite";
  const times = cleanTimes(b.start, b.end);
  const agents = await cleanAgents(b.agents);
  let ticketId = null;
  let customerId = b.customerId ? Number(b.customerId) : null;
  if (b.ticketId) {
    const [t] = await db
      .select({ id: tickets.id, customerId: tickets.customerId })
      .from(tickets)
      .where(eq(tickets.id, Number(b.ticketId)));
    if (!t) throw new BadInput("That ticket isn't there anymore.");
    ticketId = t.id;
    customerId ??= t.customerId;
  }
  if (customerId) {
    const [c] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!c) throw new BadInput("That customer isn't there anymore.");
  }
  const [job] = await db
    .insert(jobs)
    .values({
      title,
      kind,
      ...times,
      location: cleanText(b.location, { label: "Location", max: 300 }),
      notes: cleanText(b.notes, { label: "Notes", max: 5000 }),
      ticketId,
      customerId,
      createdById: req.user.id,
    })
    .returning();
  await db
    .insert(jobAgents)
    .values(agents.map((userId) => ({ jobId: job.id, userId })));

  // Tell the agents (not whoever booked it, if they're on it)
  notify(
    agents.filter((id) => id !== req.user.id),
    {
      kind: "job",
      title: `New job: ${title}`,
      body: `${KIND_WORDS[kind]}, ${when(times.startsAt)}. Booked by ${req.user.name}.`,
      ticketId,
    },
  ).catch(() => {});
  res.status(201).json(await loadJob(job.id));
});

jobsRouter.patch("/:id", async (req, res) => {
  const before = await loadJob(req.params.id);
  if (!mayChange(req.user, before))
    throw new BadInput(
      "Only Admins, the agents on this job, or whoever booked it can change it.",
      403,
    );
  const b = req.body ?? {};
  const changes = { updatedAt: new Date() };
  if ("title" in b)
    changes.title = cleanText(b.title, {
      label: "Title",
      required: true,
      max: 200,
    });
  if ("kind" in b && KINDS.includes(b.kind)) changes.kind = b.kind;
  if ("location" in b)
    changes.location = cleanText(b.location, { label: "Location", max: 300 });
  if ("notes" in b)
    changes.notes = cleanText(b.notes, { label: "Notes", max: 5000 });
  if ("done" in b) changes.doneAt = b.done ? new Date() : null;
  const moved = "start" in b || "end" in b;
  if (moved) {
    Object.assign(
      changes,
      cleanTimes(b.start ?? before.start, b.end ?? before.end),
    );
    changes.remindedAt = null; // remind again for the new time
  }
  await db.update(jobs).set(changes).where(eq(jobs.id, before.id));

  let agents = before.agents;
  if ("agents" in b) {
    agents = await cleanAgents(b.agents);
    await db.delete(jobAgents).where(eq(jobAgents.jobId, before.id));
    await db
      .insert(jobAgents)
      .values(agents.map((userId) => ({ jobId: before.id, userId })));
  }
  const after = await loadJob(before.id);

  // Tell people what changed for them
  const added = agents.filter(
    (id) => !before.agents.includes(id) && id !== req.user.id,
  );
  const removed = before.agents.filter(
    (id) => !agents.includes(id) && id !== req.user.id,
  );
  const timeChanged =
    moved && (after.start !== before.start || after.end !== before.end);
  if (added.length)
    notify(added, {
      kind: "job",
      title: `New job: ${after.title}`,
      body: `${KIND_WORDS[after.kind]}, ${when(after.start)}. Added by ${req.user.name}.`,
      ticketId: after.ticketId,
    }).catch(() => {});
  if (removed.length)
    notify(removed, {
      kind: "job",
      title: `Taken off a job: ${after.title}`,
      body: `${when(after.start)}. Changed by ${req.user.name}.`,
      ticketId: after.ticketId,
    }).catch(() => {});
  if (timeChanged) {
    const stayed = agents.filter(
      (id) => before.agents.includes(id) && id !== req.user.id,
    );
    notify(stayed, {
      kind: "job",
      title: `Job moved: ${after.title}`,
      body: `Now ${when(after.start)} (was ${when(before.start)}). Moved by ${req.user.name}.`,
      ticketId: after.ticketId,
    }).catch(() => {});
  }
  res.json(after);
});

// Answering the "It's time" alert: snooze (it comes back after that many
// minutes), or I'm here / dismiss (it stops for me)
jobsRouter.post("/:id/ack", async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!job.agents.includes(req.user.id))
    throw new BadInput("You're not on this job.", 403);
  const snooze = Math.min(60, Math.max(0, Number(req.body?.snooze) || 0));
  const mine = and(
    eq(jobAgents.jobId, job.id),
    eq(jobAgents.userId, req.user.id),
  );
  if (snooze)
    // The next alert comes 2 minutes after "last alert", so pretend the
    // last one is still to come
    await db
      .update(jobAgents)
      .set({
        lastAlertAt: new Date(Date.now() + (snooze - 2) * MINUTE),
        alerts: 0,
      })
      .where(mine);
  else await db.update(jobAgents).set({ ackAt: new Date() }).where(mine);
  res.json({ ok: true });
});

jobsRouter.delete("/:id", async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!mayChange(req.user, job))
    throw new BadInput(
      "Only Admins, the agents on this job, or whoever booked it can remove it.",
      403,
    );
  await db.delete(jobs).where(eq(jobs.id, job.id));
  if (job.start > Date.now())
    notify(
      job.agents.filter((id) => id !== req.user.id),
      {
        kind: "job",
        title: `Job cancelled: ${job.title}`,
        body: `It was ${when(job.start)}. Removed by ${req.user.name}.`,
        ticketId: job.ticketId,
      },
    ).catch(() => {});
  res.json({ ok: true });
});

// ---------- "Starts in 15 minutes", and "It's time" ----------

async function remindSoon() {
  const now = new Date();
  const soon = await db
    .select()
    .from(jobs)
    .where(
      and(
        isNull(jobs.remindedAt),
        isNull(jobs.doneAt),
        gt(jobs.startsAt, new Date(now.getTime() + 2 * MINUTE)),
        lte(jobs.startsAt, new Date(now.getTime() + 15 * MINUTE)),
      ),
    );
  for (const job of soon) {
    await db.update(jobs).set({ remindedAt: now }).where(eq(jobs.id, job.id));
    const agents = await db
      .select({ userId: jobAgents.userId })
      .from(jobAgents)
      .where(eq(jobAgents.jobId, job.id));
    const minutes = Math.max(1, Math.round((job.startsAt - now) / MINUTE));
    await notify(
      agents.map((a) => a.userId),
      {
        kind: "job",
        title: `In ${minutes} min: ${job.title}`,
        body: [KIND_WORDS[job.kind], job.location].filter(Boolean).join(", "),
        ticketId: job.ticketId,
      },
    );
  }
}

// The job's time has come: each agent on it who hasn't answered gets an
// urgent notification (it stays on the phone's screen until tapped, and
// vibrates), again every 2 minutes, up to 5 times
async function alertNow() {
  const now = new Date();
  const due = await db
    .select({ agent: jobAgents, job: jobs, customerName: customers.name })
    .from(jobAgents)
    .innerJoin(jobs, eq(jobAgents.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        isNull(jobAgents.ackAt),
        isNull(jobs.doneAt),
        lte(jobs.startsAt, now),
        gt(jobs.endsAt, now),
        lt(jobAgents.alerts, 5),
        or(
          isNull(jobAgents.lastAlertAt),
          lte(jobAgents.lastAlertAt, new Date(now.getTime() - 2 * MINUTE)),
        ),
      ),
    );
  for (const { agent, job, customerName } of due) {
    await db
      .update(jobAgents)
      .set({ alerts: sql`${jobAgents.alerts} + 1`, lastAlertAt: now })
      .where(
        and(
          eq(jobAgents.jobId, agent.jobId),
          eq(jobAgents.userId, agent.userId),
        ),
      );
    await notify([agent.userId], {
      kind: "jobNow",
      title: `It's time: ${job.title}`,
      body:
        [KIND_WORDS[job.kind], customerName, job.location]
          .filter(Boolean)
          .join(", ") + ". Tap to answer.",
      ticketId: job.ticketId,
    });
  }
}

export function startJobReminders() {
  const run = () =>
    Promise.all([remindSoon(), alertNow()]).catch((err) =>
      console.error("Jobs:", err),
    );
  setTimeout(run, 20 * 1000).unref();
  setInterval(run, MINUTE).unref();
}
