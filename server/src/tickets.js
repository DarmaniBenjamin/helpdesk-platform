// Tickets: the requests, their conversation (replies, internal notes and
// history lines), customer ratings and Ticket Review ticks.
//
// Who can do what (see permissions.js):
// - Staff see and work on every ticket. Only Admins create tickets.
// - A customer sees only their own tickets, never internal notes or
//   history lines. They can send requests, reply, mark a ticket fixed,
//   and rate it once it's finished.
import { Router } from "express";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  tickets,
  messages,
  customers,
  departments,
  users,
} from "./db/schema.js";
import { requireAuth, requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput, cleanText } from "./validate.js";
import {
  onTicketCreated,
  onTicketAssigned,
  onCustomerReply,
} from "./notify.js";
import { afterTicketEvent } from "./automation.js";
import { recordEvent } from "./activity.js";
import {
  checkFiles,
  claimFiles,
  filesForMessages,
  filesOfTicket,
  filesOfMessage,
  removeFiles,
} from "./attachments.js";

export const ticketsRouter = Router();

const HOUR = 60 * 60 * 1000;

// Same as the front end's src/data.js
const STATUSES = {
  open: "Open",
  pending: "Pending",
  waiting: "Waiting on Customer",
  resolved: "Resolved",
  closed: "Closed",
};
const PRIORITIES = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };
// How fast each priority must be answered / fixed, in hours
const SLA_HOURS = {
  1: { firstResponse: 8, resolve: 72 },
  2: { firstResponse: 4, resolve: 24 },
  3: { firstResponse: 2, resolve: 8 },
  4: { firstResponse: 1, resolve: 4 },
};
const isDone = (status) => status === "resolved" || status === "closed";
const isStaff = (user) => STAFF.includes(user.role);

// ---------- Turning database rows into what the front end uses ----------

const ms = (date) => (date ? date.getTime() : null);

function publicCustomer(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? "", // "" = no email yet (some Freshdesk contacts)
    phone: c.phone,
    company: c.company,
    extraEmails: c.extraEmails,
    extraPhones: c.extraPhones,
    createdAt: ms(c.createdAt),
  };
}

// Loads tickets with their customer, conversation and reviewer, shaped
// the way the pages expect. Customers never get notes or history lines.
async function loadTickets(where, viewer) {
  const rows = await db
    .select({ ticket: tickets, customer: customers, reviewer: users.name })
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .leftJoin(users, eq(tickets.reviewedById, users.id))
    .where(where)
    .orderBy(desc(tickets.createdAt));
  if (rows.length === 0) return [];

  const allMessages = await db
    .select()
    .from(messages)
    .where(
      inArray(
        messages.ticketId,
        rows.map((r) => r.ticket.id),
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id));
  // Customers never see notes or history lines. Staff get the history
  // too (Ticket Review uses it), but the ticket page doesn't show it:
  // changes go to the bell instead (see activity.js).
  const visible = allMessages.filter(
    (m) => isStaff(viewer) || (m.kind !== "note" && m.kind !== "event"),
  );
  // The files sent with each message (attachments.js)
  const files = await filesForMessages(visible.map((m) => m.id));
  const byTicket = {};
  for (const m of visible) {
    (byTicket[m.ticketId] ??= []).push({
      id: m.id,
      kind: m.kind,
      author: m.authorName,
      // Who wrote it (staff only), so the page knows who can delete a note
      ...(isStaff(viewer) ? { authorId: m.authorId } : {}),
      body: m.body,
      at: ms(m.createdAt),
      attachments: files[m.id] ?? [],
    });
  }

  return rows.map(({ ticket: t, customer, reviewer }) => ({
    id: t.id,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    department: t.departmentId,
    customerId: t.customerId,
    requester: publicCustomer(customer),
    assignee: t.assigneeId,
    source: t.source,
    tags: t.tags,
    createdAt: ms(t.createdAt),
    updatedAt: ms(t.updatedAt),
    firstResponseDue: ms(t.firstResponseDue),
    dueBy: ms(t.dueBy),
    firstRespondedAt: ms(t.firstRespondedAt),
    resolvedAt: ms(t.resolvedAt),
    closedAt: ms(t.closedAt),
    feedback: t.feedbackRating
      ? {
          rating: t.feedbackRating,
          comment: t.feedbackComment ?? "",
          at: ms(t.feedbackAt),
        }
      : null,
    review: t.reviewedAt ? { by: reviewer ?? "", at: ms(t.reviewedAt) } : null,
    messages: byTicket[t.id] ?? [],
  }));
}

async function loadTicket(id, viewer) {
  const [ticket] = await loadTickets(eq(tickets.id, id), viewer);
  return ticket;
}

// Finds a ticket the person is allowed to see
async function findTicket(id, viewer) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, Number(id) || 0));
  if (!ticket || (!isStaff(viewer) && ticket.customerId !== viewer.customerId))
    throw new BadInput("That ticket doesn't exist.", 404);
  return ticket;
}

// Adds lines to a ticket's conversation. Returns them, with their IDs,
// in the same order.
async function addMessages(ticketId, list) {
  if (list.length === 0) return [];
  return db
    .insert(messages)
    .values(list.map((m) => ({ ticketId, ...m })))
    .returning({ id: messages.id });
}

// The times that go with a status: resolved/closed get stamped, and
// reopening clears them
function statusTimes(ticket, status, now) {
  if (isDone(status)) {
    return {
      resolvedAt: ticket.resolvedAt ?? now,
      closedAt: status === "closed" ? (ticket.closedAt ?? now) : null,
    };
  }
  return { resolvedAt: null, closedAt: null };
}

// What kind of change it is (see activity.js)
function eventTypeOf(field, value) {
  if (field === "status") return `status:${value}`;
  if (field === "assigneeId") return "assigned";
  if (field === "departmentId") return "department";
  return field; // priority, dueBy
}

// A change in words, like "changed status to Closed (from Resolved)"
async function describeChange(field, value, actor, before) {
  switch (field) {
    case "status":
      return before
        ? `changed status to ${STATUSES[value]} (from ${STATUSES[before]})`
        : `changed status to ${STATUSES[value]}`;
    case "priority":
      return `changed priority to ${PRIORITIES[value]}`;
    case "departmentId": {
      if (!value) return "moved the ticket to No team yet";
      const [d] = await db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, value));
      return `moved the ticket to ${d?.name ?? "another department"}`;
    }
    case "assigneeId": {
      if (!value) return "unassigned the ticket";
      if (value === actor.id) return "took the ticket";
      const [u] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, value));
      return `assigned the ticket to ${u?.name ?? "someone"}`;
    }
    case "dueBy":
      return `changed the due date to ${value.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;
    default:
      return `updated ${field}`;
  }
}

// ---------- Checking what's sent ----------

function cleanStatus(value) {
  if (!(value in STATUSES)) throw new BadInput("That status isn't valid.");
  return value;
}

function cleanPriority(value) {
  const p = Number(value);
  if (!(p in PRIORITIES)) throw new BadInput("That priority isn't valid.");
  return p;
}

function cleanDate(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime()))
    throw new BadInput("That date isn't valid.");
  return date;
}

async function cleanDepartment(value) {
  if (value === null || value === "") return null;
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, String(value)));
  if (!d) throw new BadInput("That department doesn't exist.");
  return d.id;
}

// Only active staff can be given tickets
async function cleanAssignee(value) {
  if (value === null || value === "") return null;
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, String(value)),
        eq(users.status, "active"),
        inArray(users.role, STAFF),
      ),
    );
  if (!u) throw new BadInput("That person can't be given tickets.");
  return u.id;
}

// ================================================================
// The routes: /api/tickets
// ================================================================

// Every ticket for staff; only their own for a customer
ticketsRouter.get("/", requireAuth, async (req, res) => {
  if (isStaff(req.user))
    return res.json(await loadTickets(undefined, req.user));
  if (!req.user.customerId) return res.json([]);
  res.json(
    await loadTickets(eq(tickets.customerId, req.user.customerId), req.user),
  );
});

// One ticket, e.g. when a notification says it's new or changed
ticketsRouter.get("/:id", requireAuth, async (req, res) => {
  const ticket = await findTicket(req.params.id, req.user);
  res.json(await loadTicket(ticket.id, req.user));
});

// A new ticket. Admins create them for any customer (Add Ticket); a
// customer sends one from the customer portal (it arrives with no
// department and nobody assigned, for the team to sort).
ticketsRouter.post("/", requireAuth, async (req, res) => {
  const now = new Date();
  const subject = cleanText(req.body?.subject, {
    label: "Subject",
    max: 200,
    required: true,
  });
  const description = cleanText(req.body?.description, {
    label: "Description",
    max: 20000,
    required: true,
  });
  // Files sent with the request (uploaded first, see attachments.js)
  const fileIds = await checkFiles(req.body?.attachmentIds, req.user);

  let values;
  if (ADMINS.includes(req.user.role)) {
    const priority = cleanPriority(req.body?.priority ?? 2);
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, Number(req.body?.customerId) || 0));
    if (!customer) throw new BadInput("Pick a customer.");
    values = {
      customerId: customer.id,
      priority,
      departmentId: await cleanDepartment(req.body?.department),
      dueBy: req.body?.dueBy
        ? cleanDate(req.body.dueBy)
        : new Date(now.getTime() + SLA_HOURS[priority].resolve * HOUR),
      source: "agent",
      authorName: customer.name,
    };
  } else if (req.user.role === "customer" && req.user.customerId) {
    const priority = 2; // Medium, until the team looks at it
    values = {
      customerId: req.user.customerId,
      priority,
      departmentId: null,
      dueBy: new Date(now.getTime() + SLA_HOURS[priority].resolve * HOUR),
      source: "portal",
      authorName: req.user.name,
    };
  } else {
    throw new BadInput("You don't have access to this.", 403);
  }

  const { authorName, ...ticketValues } = values;
  const [created] = await db
    .insert(tickets)
    .values({
      ...ticketValues,
      subject,
      description,
      status: "open",
      firstResponseDue: new Date(
        now.getTime() + SLA_HOURS[ticketValues.priority].firstResponse * HOUR,
      ),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  // The request itself is the first message in the conversation
  const [first] = await addMessages(created.id, [
    {
      kind: "customer",
      authorId: req.user.role === "customer" ? req.user.id : null,
      authorName,
      body: description,
      createdAt: now,
    },
  ]);
  await claimFiles(fileIds, created.id, first.id);
  // Recorded (who made it); the Admins get "New ticket" in their bell
  await recordEvent({
    ticket: created,
    actor: req.user,
    type: "created",
    body:
      req.user.role === "customer"
        ? "sent this request from the customer portal"
        : "created the ticket",
    at: new Date(now.getTime() + 1),
  });
  // Assignment rules and "A new ticket is created" automations
  await afterTicketEvent(created.id, "created");
  onTicketCreated(created, authorName, req.user);
  res.status(201).json(await loadTicket(created.id, req.user));
});

// Change a ticket's status, priority, department, assignee or due date.
// Each change is recorded and sent to the bell of the people involved
// (see activity.js). A customer can only mark their own ticket as fixed
// (Resolved).
ticketsRouter.patch("/:id", requireAuth, async (req, res) => {
  const ticket = await findTicket(req.params.id, req.user);
  const body = req.body ?? {};
  const changes = {};

  if (isStaff(req.user)) {
    if ("status" in body) changes.status = cleanStatus(body.status);
    if ("priority" in body) changes.priority = cleanPriority(body.priority);
    if ("department" in body)
      changes.departmentId = await cleanDepartment(body.department);
    if ("assignee" in body)
      changes.assigneeId = await cleanAssignee(body.assignee);
    if ("dueBy" in body) changes.dueBy = cleanDate(body.dueBy);
  } else {
    if (
      Object.keys(body).some((k) => k !== "status") ||
      body.status !== "resolved"
    )
      throw new BadInput("You can only mark your request as fixed.", 403);
    if (isDone(ticket.status))
      throw new BadInput("This request is already finished.");
    changes.status = "resolved";
  }

  // Only what actually changes
  for (const [field, value] of Object.entries(changes)) {
    const before = ticket[field];
    const same =
      before instanceof Date
        ? before.getTime() === value.getTime()
        : before === value;
    if (same) delete changes[field];
  }

  if (Object.keys(changes).length) {
    const now = new Date();
    await db
      .update(tickets)
      .set({
        ...changes,
        ...(changes.status ? statusTimes(ticket, changes.status, now) : {}),
        // A new due date: the "due soon" and "overdue" warnings can go
        // out again for it
        ...(changes.dueBy
          ? { dueSoonNotifiedAt: null, overdueNotifiedAt: null }
          : {}),
        updatedAt: now,
      })
      .where(eq(tickets.id, ticket.id));
    // One record per change. Who's notified is worked out from the
    // ticket as it is now (e.g. the new person it's assigned to).
    const [after] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticket.id));
    for (const [field, value] of Object.entries(changes)) {
      await recordEvent({
        ticket: after,
        actor: req.user,
        type: eventTypeOf(field, value),
        body: await describeChange(field, value, req.user, ticket[field]),
        // The person who had it before hears about it being taken off them
        alsoTell:
          field === "assigneeId" || field === "status"
            ? [ticket.assigneeId]
            : [],
        at: now,
      });
    }
    if (changes.assigneeId)
      onTicketAssigned(ticket, changes.assigneeId, req.user);
    // "The status changes to" automations
    if (changes.status)
      await afterTicketEvent(ticket.id, "statusChanged", changes.status);
  }
  res.json(await loadTicket(ticket.id, req.user));
});

// Add to the conversation: a reply to the customer ("agent") or an
// internal note ("note") from staff, or a reply from the customer.
// Staff can change the status at the same time ("Then set status").
ticketsRouter.post("/:id/messages", requireAuth, async (req, res) => {
  const ticket = await findTicket(req.params.id, req.user);
  const body = cleanText(req.body?.body, { label: "Message", max: 20000 });
  // Files sent with it (uploaded first, see attachments.js)
  const fileIds = await checkFiles(req.body?.attachmentIds, req.user);
  // A message needs words, files, or both
  if (!body && fileIds.length === 0)
    throw new BadInput("Write a message or attach a file.");
  const now = new Date();
  const staff = isStaff(req.user);

  const kind = staff ? String(req.body?.kind) : "customer";
  if (staff && kind !== "agent" && kind !== "note")
    throw new BadInput("That kind of message isn't valid.");
  if (!staff && ticket.status === "closed")
    throw new BadInput("This request is closed. Send a new one instead.");

  // Staff can set a new status; a customer replying to a ticket that's
  // waiting on them, or marked resolved, puts it back in the queue
  let newStatus = null;
  if (staff && req.body?.status) newStatus = cleanStatus(req.body.status);
  if (!staff && ["waiting", "resolved"].includes(ticket.status))
    newStatus = "open";
  if (newStatus === ticket.status) newStatus = null;

  const update = { updatedAt: now };
  // The first reply to the customer counts as the "first response"
  if (kind === "agent" && !ticket.firstRespondedAt)
    update.firstRespondedAt = now;
  if (newStatus)
    Object.assign(
      update,
      { status: newStatus },
      statusTimes(ticket, newStatus, now),
    );

  const lines = [
    {
      kind,
      authorId: req.user.id,
      authorName: req.user.name,
      body,
      createdAt: now,
    },
  ];
  const [sent] = await addMessages(ticket.id, lines);
  if (newStatus) {
    await recordEvent({
      ticket,
      actor: req.user,
      type: `status:${newStatus}`,
      body: `changed status to ${STATUSES[newStatus]} (from ${STATUSES[ticket.status]})`,
      // A moment after the message, so it always comes after it
      at: new Date(now.getTime() + 1),
    });
  }
  await claimFiles(fileIds, ticket.id, sent.id);
  await db.update(tickets).set(update).where(eq(tickets.id, ticket.id));
  if (kind === "customer") {
    onCustomerReply(
      ticket,
      req.user.name,
      body || `Sent ${fileIds.length} file${fileIds.length === 1 ? "" : "s"}`,
    );
    await afterTicketEvent(ticket.id, "customerReply");
  }
  if (newStatus) await afterTicketEvent(ticket.id, "statusChanged", newStatus);
  res.status(201).json(await loadTicket(ticket.id, req.user));
});

// Delete an internal note. Only notes can be deleted (replies were
// already seen by the customer). Whoever wrote the note can delete it,
// and so can Admins and the Super Admin. Its files go too. The people
// involved get it in their bell.
ticketsRouter.delete(
  "/:id/messages/:messageId",
  requireRole(...STAFF),
  async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    const [note] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, Number(req.params.messageId) || 0),
          eq(messages.ticketId, ticket.id),
        ),
      );
    if (!note) throw new BadInput("That note doesn't exist.", 404);
    if (note.kind !== "note")
      throw new BadInput("Only internal notes can be deleted.");
    if (note.authorId !== req.user.id && !ADMINS.includes(req.user.role))
      throw new BadInput("You can only delete your own notes.", 403);

    // Its files are removed from the uploads folder too (the file
    // records are deleted with the note)
    const fileKeys = await filesOfMessage(note.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.id, note.id));
      // The person who has the ticket, whoever deleted it, and whoever
      // wrote the note get it in their bell
      await recordEvent({
        ticket,
        actor: req.user,
        type: "note-deleted",
        body:
          note.authorId === req.user.id
            ? "deleted their internal note"
            : `deleted an internal note by ${note.authorName}`,
        alsoTell: [note.authorId],
        at: now,
        tx,
      });
      await tx
        .update(tickets)
        .set({ updatedAt: now })
        .where(eq(tickets.id, ticket.id));
    });
    removeFiles(fileKeys);
    res.json(await loadTicket(ticket.id, req.user));
  },
);

// A customer rates their finished request (1-5 stars and a comment).
// Shows up on Performance & Feedback and Ticket Review.
ticketsRouter.post(
  "/:id/feedback",
  requireRole("customer"),
  async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    if (!isDone(ticket.status))
      throw new BadInput("You can rate a request once it's finished.");
    if (ticket.feedbackRating)
      throw new BadInput("You've already rated this request.");
    const rating = Number(req.body?.rating);
    if (![1, 2, 3, 4, 5].includes(rating))
      throw new BadInput("Pick from 1 to 5 stars.");
    const comment = cleanText(req.body?.comment, {
      label: "Comment",
      max: 2000,
    });

    await db
      .update(tickets)
      .set({
        feedbackRating: rating,
        feedbackComment: comment,
        feedbackAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));
    res.json(await loadTicket(ticket.id, req.user));
  },
);

// Ticket Review: an Admin ticks off a finished ticket once they've
// checked it (or takes the tick off). Recorded, and the person who has
// the ticket gets it in their bell.
ticketsRouter.post("/:id/review", requireRole(...ADMINS), async (req, res) => {
  const ticket = await findTicket(req.params.id, req.user);
  const reviewed = Boolean(req.body?.reviewed);
  const now = new Date();
  await db
    .update(tickets)
    .set({
      reviewedById: reviewed ? req.user.id : null,
      reviewedAt: reviewed ? now : null,
    })
    .where(eq(tickets.id, ticket.id));
  await recordEvent({
    ticket,
    actor: req.user,
    type: "review",
    body: reviewed
      ? "marked the ticket as reviewed"
      : "took the review tick off",
    at: now,
  });
  res.json(await loadTicket(ticket.id, req.user));
});

// Delete a ticket for good: its whole conversation, internal notes and
// history go with it. Knowledge Base answers saved from it stay, they
// just stop linking to it. Admins and the Super Admin only.
ticketsRouter.delete("/:id", requireRole(...ADMINS), async (req, res) => {
  const ticket = await findTicket(req.params.id, req.user);
  // Its files are removed from the uploads folder too. Messages and
  // file records are deleted with it (set up in the database tables).
  const fileKeys = await filesOfTicket(ticket.id);
  await db.delete(tickets).where(eq(tickets.id, ticket.id));
  removeFiles(fileKeys);
  res.json({ ok: true });
});

// Used when someone leaves the team: their unfinished tickets become
// unassigned, with a record on each saying why
export async function unassignTicketsOf(member, actor) {
  const open = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(
        eq(tickets.assigneeId, member.id),
        ne(tickets.status, "resolved"),
        ne(tickets.status, "closed"),
      ),
    );
  if (open.length === 0) return;
  const now = new Date();
  await db
    .update(tickets)
    .set({ assigneeId: null, updatedAt: now })
    .where(
      inArray(
        tickets.id,
        open.map((t) => t.id),
      ),
    );
  await db.insert(messages).values(
    open.map((t) => ({
      ticketId: t.id,
      kind: "event",
      eventType: "assigned",
      authorId: actor.id,
      authorName: actor.name,
      body: `unassigned the ticket (${member.name} was removed from the team)`,
      createdAt: now,
    })),
  );
}
