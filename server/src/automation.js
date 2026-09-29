// Assignment rules and automations, actually running.
//
// Assignment rules (Ticket Assignment page): when a new ticket comes in,
// its subject and description are checked for each rule's keywords. The
// rule with the most matching keywords wins, and the ticket goes to its
// team (and its agent, if the rule has one). A rule only fills in what's
// missing: a team or person already picked by whoever made the ticket
// is never changed.
//
// Automations (Automation page): "When this happens, do these things".
//   Straight away:  a new ticket, the customer replies, the status
//                   changes to something
//   Checked every 5 minutes:  no customer reply for X hours, no agent
//                   reply for X hours, resolved with no reply for X days
// Each time-based automation runs once per situation: e.g. "no agent
// reply for 4 hours" runs once after the customer's message, and again
// only after a newer message from the customer. The two "no reply"
// ones only look at waits that started after the automation was made,
// so turning one on doesn't set it off on years of old tickets.
//
// Everything they do is written into the ticket's history, with the
// rule's or automation's name, so it's always clear what happened.
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  automations,
  automationRuns,
  departments,
  messages,
  rules,
  tickets,
  userDepartments,
  users,
} from "./db/schema.js";
import { ADMINS, STAFF } from "./permissions.js";
import { notify, onTicketAssigned } from "./notify.js";
import { sendToEveryone } from "./live.js";

const HOUR = 60 * 60 * 1000;
// The name on replies sent by "Reply to the customer". Also how they're
// told apart from real replies, so "No agent reply" still works.
export const AUTO_REPLY_NAME = "Automatic reply";
const DAY = 24 * HOUR;
const isDone = (status) => status === "resolved" || status === "closed";

const STATUS_NAMES = {
  open: "Open",
  pending: "Pending",
  waiting: "Waiting on Customer",
  resolved: "Resolved",
  closed: "Closed",
};
const PRIORITY_NAMES = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };

// A history line on a ticket, written by a rule or automation
async function historyLine(ticketId, who, text, at = new Date()) {
  await db.insert(messages).values({
    ticketId,
    kind: "event",
    authorId: null,
    authorName: who,
    body: text,
    createdAt: at,
  });
}

// Tells every open tab that a ticket changed, so it shows up straight
// away (e.g. an automation closed it while you were looking)
function announce(ticketId) {
  sendToEveryone("ticketChanged", { id: ticketId });
}

// Only active staff can be given tickets
async function isActiveStaff(userId) {
  if (!userId) return false;
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, "active"),
        inArray(users.role, STAFF),
      ),
    );
  return Boolean(u);
}

// ================================================================
// Assignment rules
// ================================================================

// Runs the assignment rules on a new ticket. Returns true if it changed.
export async function runAssignmentRules(ticketId) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  if (!ticket || (ticket.departmentId && ticket.assigneeId)) return false;

  const enabled = await db
    .select()
    .from(rules)
    .where(eq(rules.enabled, true))
    .orderBy(asc(rules.id));
  const text = `${ticket.subject} ${ticket.description}`.toLowerCase();

  // The rule with the most of its keywords in the ticket wins
  let best = null;
  let bestHits = 0;
  for (const rule of enabled) {
    const hits = rule.keywords.filter((k) => text.includes(k)).length;
    if (hits > bestHits) {
      best = rule;
      bestHits = hits;
    }
  }
  if (!best) return false;

  const changes = {};
  if (!ticket.departmentId && best.departmentId)
    changes.departmentId = best.departmentId;
  if (!ticket.assigneeId && (await isActiveStaff(best.agentId)))
    changes.assigneeId = best.agentId;
  if (Object.keys(changes).length === 0) return false;

  await db.update(tickets).set(changes).where(eq(tickets.id, ticket.id));

  const parts = [];
  if (changes.departmentId) {
    const [d] = await db
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.id, changes.departmentId));
    parts.push(`sent it to ${d?.name ?? "a team"}`);
  }
  if (changes.assigneeId) {
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, changes.assigneeId));
    parts.push(`assigned it to ${u?.name ?? "someone"}`);
  }
  const who = `Assignment rule "${best.name}"`;
  await historyLine(ticket.id, who, parts.join(" and "));
  if (changes.assigneeId)
    onTicketAssigned(ticket, changes.assigneeId, { id: null, name: who });
  return true;
}

// ================================================================
// Automations: doing the actions
// ================================================================

// Who "Notify the team" goes to: whoever has the ticket; if nobody, the
// people in its team; if it has no team, the Admins
async function teamFor(ticket) {
  if (ticket.assigneeId) return [ticket.assigneeId];
  if (ticket.departmentId) {
    const rows = await db
      .select({ id: users.id })
      .from(userDepartments)
      .innerJoin(users, eq(userDepartments.userId, users.id))
      .where(
        and(
          eq(userDepartments.departmentId, ticket.departmentId),
          eq(users.status, "active"),
          inArray(users.role, STAFF),
        ),
      );
    if (rows.length) return rows.map((r) => r.id);
  }
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ADMINS), eq(users.status, "active")));
  return admins.map((r) => r.id);
}

// Does one automation's actions on one ticket. Returns the new status
// if it changed one (other automations can react to that).
async function doActions(automation, ticketId) {
  const who = `Automation "${automation.name}"`;
  let newStatus = null;

  for (const action of automation.actions) {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId));
    if (!ticket) return null;
    const now = new Date();
    const value = action.value;

    switch (action.type) {
      case "setStatus": {
        if (!STATUS_NAMES[value] || ticket.status === value) break;
        const done = isDone(value);
        await db
          .update(tickets)
          .set({
            status: value,
            resolvedAt: done ? (ticket.resolvedAt ?? now) : null,
            closedAt: value === "closed" ? (ticket.closedAt ?? now) : null,
            updatedAt: now,
          })
          .where(eq(tickets.id, ticketId));
        await historyLine(
          ticketId,
          who,
          `changed status to ${STATUS_NAMES[value]}`,
        );
        newStatus = value;
        break;
      }
      case "setPriority": {
        const p = Number(value);
        if (!PRIORITY_NAMES[p] || ticket.priority === p) break;
        await db
          .update(tickets)
          .set({ priority: p, updatedAt: now })
          .where(eq(tickets.id, ticketId));
        await historyLine(
          ticketId,
          who,
          `changed priority to ${PRIORITY_NAMES[p]}`,
        );
        break;
      }
      case "assignTeam": {
        if (!value || ticket.departmentId === value) break;
        const [d] = await db
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, String(value)));
        if (!d) break; // that team was deleted
        await db
          .update(tickets)
          .set({ departmentId: String(value), updatedAt: now })
          .where(eq(tickets.id, ticketId));
        await historyLine(ticketId, who, `moved the ticket to ${d.name}`);
        break;
      }
      case "assignAgent": {
        if (ticket.assigneeId === value || !(await isActiveStaff(value))) break;
        const [u] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, value));
        await db
          .update(tickets)
          .set({ assigneeId: value, updatedAt: now })
          .where(eq(tickets.id, ticketId));
        await historyLine(ticketId, who, `assigned the ticket to ${u.name}`);
        onTicketAssigned(ticket, value, { id: null, name: who });
        break;
      }
      case "emailCustomer": {
        // A reply the customer sees on their request (in the customer
        // portal). Real emails come once email sending is set up.
        const body = String(value ?? "").trim();
        if (!body) break;
        await db.insert(messages).values({
          ticketId,
          kind: "agent",
          authorId: null,
          authorName: AUTO_REPLY_NAME,
          body,
          createdAt: now,
        });
        await db
          .update(tickets)
          .set({ updatedAt: now })
          .where(eq(tickets.id, ticketId));
        break;
      }
      case "notifyTeam": {
        await notify(await teamFor(ticket), {
          kind: "automation",
          title: `#${ticket.id}: ${automation.name}`,
          body: ticket.subject,
          ticketId,
        });
        break;
      }
      case "addNote": {
        const body = String(value ?? "").trim();
        if (!body) break;
        await db.insert(messages).values({
          ticketId,
          kind: "note",
          authorId: null,
          authorName: who,
          body,
          createdAt: now,
        });
        break;
      }
      case "addTag": {
        const tag = String(value ?? "")
          .trim()
          .toLowerCase()
          .slice(0, 50);
        if (!tag || ticket.tags.includes(tag)) break;
        await db
          .update(tickets)
          .set({ tags: [...ticket.tags, tag].slice(0, 20), updatedAt: now })
          .where(eq(tickets.id, ticketId));
        await historyLine(ticketId, who, `added the tag "${tag}"`);
        break;
      }
      default:
        break;
    }
  }

  await db
    .update(automations)
    .set({ runs: sql`${automations.runs} + 1` })
    .where(eq(automations.id, automation.id));
  return newStatus;
}

// ================================================================
// Automations: things that happen (run straight away)
// ================================================================

// Runs every enabled automation for an event on a ticket.
//   event: "created", "customerReply" or "statusChanged"
//   status: for statusChanged, the new status
// If an automation changes the status, "status changes to" automations
// run for that too. Each automation runs at most once per chain, so
// two automations can never keep setting each other off.
export async function runAutomations(ticketId, event, status, ran = new Set()) {
  if (ran.size >= 10) return; // plenty; stops runaway chains
  const list = await db
    .select()
    .from(automations)
    .where(eq(automations.enabled, true))
    .orderBy(asc(automations.id));

  for (const automation of list) {
    const trigger = automation.trigger ?? {};
    if (trigger.type !== event || ran.has(automation.id)) continue;
    if (event === "statusChanged" && trigger.value !== status) continue;
    ran.add(automation.id);
    const changedTo = await doActions(automation, ticketId);
    if (changedTo)
      await runAutomations(ticketId, "statusChanged", changedTo, ran);
  }
}

// Called by tickets.js when something happens. Errors are logged, never
// passed on: a broken automation shouldn't stop someone's reply saving.
export async function afterTicketEvent(ticketId, event, status) {
  try {
    if (event === "created") await runAssignmentRules(ticketId);
    await runAutomations(ticketId, event, status);
  } catch (err) {
    console.error("Automation:", err);
  }
}

// ================================================================
// Automations: time-based (checked every 5 minutes)
// ================================================================

// The last message of each kind on these tickets:
// ticket ID -> { customer: Date, agent: Date }
async function lastMessages(ticketIds) {
  if (ticketIds.length === 0) return {};
  const rows = await db
    .select({
      ticketId: messages.ticketId,
      kind: messages.kind,
      at: sql`max(${messages.createdAt})`.mapWith((v) => new Date(v)),
    })
    .from(messages)
    .where(
      and(
        inArray(messages.ticketId, ticketIds),
        inArray(messages.kind, ["customer", "agent"]),
        // Automatic replies don't count as someone replying
        sql`not (${messages.kind} = 'agent' and ${messages.authorId} is null and ${messages.authorName} = ${AUTO_REPLY_NAME})`,
      ),
    )
    .groupBy(messages.ticketId, messages.kind);
  const result = {};
  for (const r of rows) (result[r.ticketId] ??= {})[r.kind] = r.at;
  return result;
}

// For one ticket and a time-based trigger: the moment the waiting
// started, if it has waited long enough. null = not (yet).
function waitingSince(trigger, ticket, last, now) {
  const hours = Number(trigger.value) || 0;
  const days = Number(trigger.value) || 0;
  const { customer, agent } = last ?? {};

  if (trigger.type === "noCustomerReply") {
    // The team replied last, and the customer hasn't answered since
    if (isDone(ticket.status) || !agent) return null;
    if (customer && customer > agent) return null;
    return now - agent >= hours * HOUR ? agent : null;
  }
  if (trigger.type === "noAgentReply") {
    // The customer wrote last (or only the request so far), and nobody
    // on the team has replied since
    if (isDone(ticket.status) || !customer) return null;
    if (agent && agent > customer) return null;
    return now - customer >= hours * HOUR ? customer : null;
  }
  if (trigger.type === "resolvedFor") {
    // Resolved, and the customer hasn't written since
    if (ticket.status !== "resolved" || !ticket.resolvedAt) return null;
    if (customer && customer > ticket.resolvedAt) return null;
    return now - ticket.resolvedAt >= days * DAY ? ticket.resolvedAt : null;
  }
  return null;
}

const TIME_TRIGGERS = ["noCustomerReply", "noAgentReply", "resolvedFor"];

async function checkTimeBased() {
  const timed = (
    await db
      .select()
      .from(automations)
      .where(eq(automations.enabled, true))
      .orderBy(asc(automations.id))
  ).filter((a) => TIME_TRIGGERS.includes(a.trigger?.type));
  if (timed.length === 0) return;

  // Only tickets that could match: not closed
  const list = await db
    .select()
    .from(tickets)
    .where(notInArray(tickets.status, ["closed"]));
  const last = await lastMessages(list.map((t) => t.id));
  const now = new Date();

  for (const automation of timed) {
    for (const ticket of list) {
      const since = waitingSince(
        automation.trigger,
        ticket,
        last[ticket.id],
        now,
      );
      if (!since) continue;
      if (
        automation.trigger.type !== "resolvedFor" &&
        since < automation.createdAt
      )
        continue;
      // Once per situation: the moment the waiting started is recorded,
      // so the same wait never runs it twice
      const anchor = since.toISOString();
      const inserted = await db
        .insert(automationRuns)
        .values({ automationId: automation.id, ticketId: ticket.id, anchor })
        .onConflictDoNothing()
        .returning({ id: automationRuns.automationId });
      if (inserted.length === 0) continue;

      try {
        const changedTo = await doActions(automation, ticket.id);
        if (changedTo)
          await runAutomations(
            ticket.id,
            "statusChanged",
            changedTo,
            new Set([automation.id]),
          );
        announce(ticket.id);
      } catch (err) {
        console.error(`Automation "${automation.name}":`, err);
      }
    }
  }
}

export function startAutomations() {
  const run = () =>
    checkTimeBased().catch((err) => console.error("Automations:", err));
  run();
  setInterval(run, 5 * 60 * 1000);
}
