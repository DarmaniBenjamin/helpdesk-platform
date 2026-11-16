// Importing from Freshdesk: saves the customers and tickets that the
// Settings page worked out (see src/Components/freshdeskMapping.js in
// the front end) into the database.
//
// The page sends them in batches, customers first, then tickets:
//   POST /api/import/customers  { customers: [...], replace }
//   POST /api/import/tickets    { tickets: [...], replace }
//   POST /api/import/reminders  { reminders: [...] }  tickets the team
//        opened for themselves: they go on the Reminders page instead
// replace = true: overwrite ones that are already here. false: skip them.
// "newer": a ticket already here is updated only if Freshdesk changed it
// after it was last changed here; its new replies and notes are added and
// anything added here is kept. Customers already here are left as they are.
//
// Every record is checked again here, so nothing odd gets into the
// database even if the page sent it. One bad record is skipped (with a
// reason) instead of stopping the whole import.
import { Router } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  customers,
  tickets,
  messages,
  departments,
  users,
  reminders,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";
import { getSla } from "./sla.js";

export const importRouter = Router();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const STATUSES = ["open", "pending", "waiting", "resolved", "closed"];
const SOURCES = ["email", "portal", "phone", "agent"];
const MESSAGE_KINDS = ["customer", "agent", "note", "event"];
const MAX_PER_BATCH = 1000;

// ---------- Small cleaners (never throw: odd values get a safe default) ----------

// Text, trimmed and cut to a length. Imported text can be long, so it's
// shortened instead of refused.
function text(value, max) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function emailOrNull(value) {
  const email = text(value, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// A positive whole number (IDs), or null
function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Milliseconds -> a Date, or the fallback if it isn't a real time
function date(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const d = new Date(Number(value));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// A list of short texts: cleaned, no blanks, no repeats
function list(value, clean, max = 20) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))].slice(0, max);
}

const phone = (value) => text(value, 40);
const tag = (value) => text(value, 50).toLowerCase();

function checkBatch(items, what) {
  if (!Array.isArray(items)) throw new BadInput(`Send a list of ${what}.`);
  if (items.length > MAX_PER_BATCH)
    throw new BadInput(`Send at most ${MAX_PER_BATCH} ${what} at a time.`);
}

// ================================================================
// POST /api/import/customers
// ================================================================

importRouter.post("/customers", requireRole(...ADMINS), async (req, res) => {
  const incoming = req.body?.customers;
  const replace = req.body?.replace === true;
  checkBatch(incoming, "customers");

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const problems = [];

  for (const c of incoming) {
    const id = positiveId(c?.id);
    const email = emailOrNull(c?.email);
    const phones = list([c?.phone, ...(c?.extraPhones ?? [])], phone);
    const name =
      text(c?.name, 100) || email || phones[0] || (id ? `Contact ${id}` : "");
    if (!id || !name) {
      problems.push(`${name || "A contact"} (no contact ID)`);
      continue;
    }

    const values = {
      name,
      email,
      phone: phones[0] ?? "",
      company: text(c?.company, 100) || null,
      extraEmails: list(c?.extraEmails, emailOrNull).filter((e) => e !== email),
      extraPhones: phones.slice(1),
      createdAt: date(c?.createdAt, new Date()),
    };

    try {
      // Already here? Same ID, or one of their emails is used by someone
      const emails = [email, ...values.extraEmails].filter(Boolean);
      const [existing] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          or(
            eq(customers.id, id),
            ...emails.map((e) =>
              or(
                eq(customers.email, e),
                sql`${e} = any(${customers.extraEmails})`,
              ),
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        await db.insert(customers).values({ id, ...values });
        added += 1;
      } else if (replace) {
        // Keep their ID here, so their tickets and portal login stay linked
        await db
          .update(customers)
          .set(values)
          .where(eq(customers.id, existing.id));
        updated += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      // e.g. their email belongs to a different customer here
      console.error("Import customer", id, err.message);
      problems.push(`${name} (couldn't be saved: email already in use?)`);
    }
  }

  res.json({ added, updated, skipped, problems });
});

// ================================================================
// POST /api/import/tickets
// ================================================================

importRouter.post("/tickets", requireRole(...ADMINS), async (req, res) => {
  const incoming = req.body?.tickets;
  const replace = req.body?.replace === true;
  const newer = req.body?.replace === "newer";
  checkBatch(incoming, "tickets");
  // How fast each priority must be answered / fixed, in hours (sla.js),
  // for tickets that don't bring their own due times
  const SLA_HOURS = await getSla();

  // Looked up once per batch instead of once per ticket
  const departmentIds = new Set(
    (await db.select({ id: departments.id }).from(departments)).map(
      (d) => d.id,
    ),
  );
  // Only active staff can be given tickets (same rule as tickets.js)
  const staffIds = new Set(
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.status, "active"), inArray(users.role, STAFF)))
    ).map((u) => u.id),
  );
  const customerIds = list(
    incoming.map((t) => t?.customerId),
    positiveId,
    MAX_PER_BATCH,
  );
  const knownCustomers = new Set(
    customerIds.length
      ? (
          await db
            .select({ id: customers.id })
            .from(customers)
            .where(inArray(customers.id, customerIds))
        ).map((c) => c.id)
      : [],
  );

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const problems = [];
  const now = new Date();

  for (const t of incoming) {
    const id = positiveId(t?.id);
    const subject = text(t?.subject, 200);
    const customerId = positiveId(t?.customerId);
    if (!id || !subject) {
      problems.push(`${subject || "A ticket"} (missing number or subject)`);
      continue;
    }
    if (!knownCustomers.has(customerId)) {
      problems.push(`#${id} ${subject} (its customer isn't here)`);
      continue;
    }

    const priority = [1, 2, 3, 4].includes(Number(t.priority))
      ? Number(t.priority)
      : 2;
    const status = STATUSES.includes(t.status) ? t.status : "open";
    const createdAt = date(t.createdAt, now);
    const done = status === "resolved" || status === "closed";

    const values = {
      subject,
      description: text(t.description, 100000),
      status,
      priority,
      departmentId: departmentIds.has(t.department) ? t.department : null,
      customerId,
      assigneeId: staffIds.has(t.assignee) ? t.assignee : null,
      source: SOURCES.includes(t.source) ? t.source : "email",
      tags: list(t.tags, tag),
      createdAt,
      updatedAt: date(t.updatedAt, createdAt),
      firstResponseDue: date(
        t.firstResponseDue,
        new Date(
          createdAt.getTime() + SLA_HOURS[priority].firstResponse * HOUR,
        ),
      ),
      dueBy: date(
        t.dueBy,
        new Date(createdAt.getTime() + SLA_HOURS[priority].resolve * HOUR),
      ),
      firstRespondedAt: date(t.firstRespondedAt, null),
      resolvedAt: done
        ? date(t.resolvedAt, date(t.updatedAt, createdAt))
        : null,
      closedAt:
        status === "closed"
          ? date(t.closedAt, date(t.updatedAt, createdAt))
          : null,
    };

    const conversation = (Array.isArray(t.messages) ? t.messages : [])
      .slice(0, 2000)
      .map((m) => ({
        ticketId: id,
        kind: MESSAGE_KINDS.includes(m?.kind) ? m.kind : "agent",
        authorName: text(m?.author, 100) || "Freshdesk",
        body: text(m?.body, 100000),
        createdAt: date(m?.at, createdAt),
      }));

    try {
      // The ticket and its conversation are saved together: all or nothing
      const outcome = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: tickets.id,
            updatedAt: tickets.updatedAt,
            createdAt: tickets.createdAt,
          })
          .from(tickets)
          .where(eq(tickets.id, id));

        // The same number but not the same ticket: one made here in Uplink
        // took that number while Freshdesk was still in use. (An imported
        // ticket keeps Freshdesk's creation time.) Never overwrite it.
        if (
          existing &&
          (replace || newer) &&
          Math.abs(existing.createdAt.getTime() - createdAt.getTime()) > MINUTE
        )
          return "clash";

        // The newer one: Freshdesk's details, and only the replies and
        // notes that aren't here yet (anything added here stays)
        if (existing && newer) {
          const key = (m) => `${m.createdAt.getTime()}|${m.body}`;
          const here = new Map(
            (
              await tx
                .select({
                  id: messages.id,
                  createdAt: messages.createdAt,
                  body: messages.body,
                  authorName: messages.authorName,
                })
                .from(messages)
                .where(eq(messages.ticketId, id))
            ).map((m) => [key(m), m]),
          );
          // Replies and notes already here: put right who wrote them (an
          // earlier import could only show the support mailbox for agents
          // who had left)
          for (const m of conversation) {
            const old = here.get(key(m));
            if (
              old &&
              m.kind !== "customer" &&
              old.authorName !== m.authorName &&
              // only a real name, never back to a mailbox
              !m.authorName.includes("@") &&
              m.authorName !== "Freshdesk agent"
            )
              await tx
                .update(messages)
                .set({ authorName: m.authorName })
                .where(eq(messages.id, old.id));
          }
          if (values.updatedAt.getTime() <= existing.updatedAt.getTime())
            return "skipped";
          await tx.update(tickets).set(values).where(eq(tickets.id, id));
          const fresh = conversation.filter((m) => !here.has(key(m)));
          if (fresh.length) await tx.insert(messages).values(fresh);
          return "updated";
        }
        if (existing && !replace) return "skipped";
        if (existing) {
          // Ratings and Ticket Review ticks aren't touched
          await tx.update(tickets).set(values).where(eq(tickets.id, id));
          await tx.delete(messages).where(eq(messages.ticketId, id));
        } else {
          await tx.insert(tickets).values({ id, ...values });
        }
        if (conversation.length) await tx.insert(messages).values(conversation);
        return existing ? "updated" : "added";
      });
      if (outcome === "clash")
        problems.push(
          `#${id} ${subject} (a ticket made here in Uplink already has #${id}, so it was left alone)`,
        );
      else if (outcome === "added") added += 1;
      else if (outcome === "updated") updated += 1;
      else skipped += 1;
    } catch (err) {
      console.error("Import ticket", id, err.message);
      problems.push(`#${id} ${subject} (couldn't be saved)`);
    }
  }

  // Tickets made in this app afterwards carry on after the highest number
  // (next_ticket_id(), migration 0015): imported tickets #256-#8123 mean
  // the next new one is #8124, and never clash with an imported one

  res.json({ added, updated, skipped, problems });
});

// ================================================================
// POST /api/import/reminders
// ================================================================
// A Freshdesk ticket that someone on the team opened for themselves (a
// reminder to renew something, an internal job) isn't a customer's
// ticket: it becomes a reminder, for the person who opened it if they're
// on the team here, otherwise for everyone. Done in Freshdesk = done
// here. Still open: it goes off at its Freshdesk due time (straight away
// if that has passed). Importing again never doubles one: each starts
// with "Freshdesk ticket #N".

function cleanTimeZone(value) {
  const tz = String(value ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

importRouter.post("/reminders", requireRole(...ADMINS), async (req, res) => {
  const incoming = req.body?.reminders;
  checkBatch(incoming, "reminders");

  const team = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.status, "active"), inArray(users.role, STAFF)));
  const byEmail = new Map(
    team.map((u) => [String(u.email).toLowerCase(), u.id]),
  );

  let added = 0;
  let skipped = 0;
  const problems = [];
  const now = new Date();

  for (const r of incoming) {
    const id = positiveId(r?.freshdeskId);
    const title = text(r?.title, 200);
    if (!id || !title) {
      problems.push(`${title || "A reminder"} (missing number or title)`);
      continue;
    }
    const marker = `Freshdesk ticket #${id}`;
    try {
      const [already] = await db
        .select({ id: reminders.id })
        .from(reminders)
        .where(
          // "#59" mustn't match "#5969"
          sql`${reminders.notes} ~ ${`^Freshdesk ticket #${id}([^0-9]|$)`}`,
        )
        .limit(1);
      if (already) {
        skipped += 1;
        continue;
      }
      const remindAt = date(r.remindAt, now);
      const by = text(r.by, 100);
      const forId = byEmail.get(String(r.byEmail ?? "").toLowerCase());
      await db.insert(reminders).values({
        title,
        notes:
          `${marker}${by ? ` (opened by ${by})` : ""}\n${text(r.notes, 1900)}`
            .trim()
            .slice(0, 2000),
        remindAt,
        allDay: false,
        repeat: "none",
        timeZone: cleanTimeZone(r.timeZone),
        everyone: !forId,
        userIds: forId ? [forId] : [],
        createdById: req.user.id,
        createdByName: by || req.user.name || "",
        // Done in Freshdesk: done here too (it never goes off)
        sentAt: r.done === true ? remindAt : null,
      });
      added += 1;
    } catch (err) {
      console.error("Import reminder", id, err.message);
      problems.push(`#${id} ${title} (couldn't be saved as a reminder)`);
    }
  }
  res.json({ added, updated: 0, skipped, problems });
});
