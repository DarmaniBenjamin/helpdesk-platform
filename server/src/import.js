// Importing from Freshdesk: saves the customers and tickets that the
// Settings page worked out (see src/Components/freshdeskMapping.js in
// the front end) into the database.
//
// The page sends them in batches, customers first, then tickets:
//   POST /api/import/customers  { customers: [...], replace }
//   POST /api/import/tickets    { tickets: [...], replace }
// replace = true: overwrite ones that are already here. false: skip them.
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
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";

export const importRouter = Router();

const HOUR = 60 * 60 * 1000;
const STATUSES = ["open", "pending", "waiting", "resolved", "closed"];
const SOURCES = ["email", "portal", "phone", "agent"];
const MESSAGE_KINDS = ["customer", "agent", "note", "event"];
// Same as tickets.js
const SLA_HOURS = {
  1: { firstResponse: 8, resolve: 72 },
  2: { firstResponse: 4, resolve: 24 },
  3: { firstResponse: 2, resolve: 8 },
  4: { firstResponse: 1, resolve: 4 },
};
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
  checkBatch(incoming, "tickets");

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
          .select({ id: tickets.id })
          .from(tickets)
          .where(eq(tickets.id, id));

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
      if (outcome === "added") added += 1;
      else if (outcome === "updated") updated += 1;
      else skipped += 1;
    } catch (err) {
      console.error("Import ticket", id, err.message);
      problems.push(`#${id} ${subject} (couldn't be saved)`);
    }
  }

  // Tickets made in this app afterwards get the next number after the
  // highest one, so they never clash with an imported Freshdesk number
  if (added > 0) {
    await db.execute(
      sql`select setval(pg_get_serial_sequence('tickets', 'id'), greatest((select max(id) from tickets), 1))`,
    );
  }

  res.json({ added, updated, skipped, problems });
});
