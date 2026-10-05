// The calendar: jobs booked for a time (a site visit, a remote session or
// a call), each done by one or more agents, usually for a ticket.
//
//   GET    /api/jobs?from=&to=      jobs in a time range (ms), for the calendar
//   GET    /api/jobs?ticketId=      a ticket's jobs (the ticket page)
//   POST   /api/jobs                book one
//   PATCH  /api/jobs/:id            change it (time, agents, done...)
//   DELETE /api/jobs/:id            remove it
//
// Everyone on the team sees every job (so they can see who's free).
// Admins can change any job; agents can change the jobs they're on or
// booked themselves, and book jobs for anyone.
//
// Notifications (the bell, and phone/desktop pop-ups): when you're put on
// a job, when your job's time is changed, and 30 minutes before it starts.
import { Router } from "express";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte } from "drizzle-orm";
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
  return rows.map(({ job: j, customerName, ticketSubject }) => ({
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

// ---------- "Starts in 30 minutes" ----------

async function remindSoon() {
  const now = new Date();
  const soon = await db
    .select()
    .from(jobs)
    .where(
      and(
        isNull(jobs.remindedAt),
        isNull(jobs.doneAt),
        gte(jobs.startsAt, now),
        lte(jobs.startsAt, new Date(now.getTime() + 30 * MINUTE)),
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

export function startJobReminders() {
  const run = () => remindSoon().catch((err) => console.error("Jobs:", err));
  setTimeout(run, 20 * 1000).unref();
  setInterval(run, MINUTE).unref();
}
