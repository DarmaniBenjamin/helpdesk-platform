// FOR DEVELOPMENT ONLY. Puts the app's example data into the database:
// the 48 example customers, 170 example tickets (with their
// conversations and ratings) and 5 Knowledge Base answers, so every page
// has something to show while you build and test.
//
// Never run this on the real database. Your real customers and tickets
// come from the Freshdesk import instead.
//
// Run with: npm run db:seed-examples
// Safe to run more than once: anything already there is left alone.
import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import {
  customers,
  tickets,
  messages,
  departments,
  answers,
} from "./schema.js";
// The example data the front end used to make up (src/data.js)
import {
  customers as exampleCustomers,
  tickets as exampleTickets,
} from "../../../src/data.js";
import { STARTING_ANSWERS as exampleAnswers } from "../../../src/Components/Knowledge.js";

const date = (ms) => (ms ? new Date(ms) : null);

try {
  // ----- Customers -----
  await db
    .insert(customers)
    .values(
      exampleCustomers.map((c) => ({
        id: c.id, // same numbers the example tickets use
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company,
        createdAt: date(c.createdAt),
      })),
    )
    .onConflictDoNothing();
  console.log(`✓ Example customers: ${exampleCustomers.length}`);

  // ----- Tickets -----
  // Only departments that exist (you may have renamed or deleted some)
  const departmentIds = new Set(
    (await db.select({ id: departments.id }).from(departments)).map(
      (d) => d.id,
    ),
  );
  const inserted = await db
    .insert(tickets)
    .values(
      exampleTickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        description: t.description,
        status: t.status,
        priority: t.priority,
        departmentId: departmentIds.has(t.department) ? t.department : null,
        customerId: t.customerId,
        assigneeId: null, // the example people don't exist
        source: t.source,
        createdAt: date(t.createdAt),
        updatedAt: date(t.updatedAt),
        firstResponseDue: date(t.firstResponseDue),
        dueBy: date(t.dueBy),
        firstRespondedAt: date(t.firstRespondedAt),
        resolvedAt: date(t.resolvedAt),
        closedAt: date(t.closedAt),
        feedbackRating: t.feedback?.rating ?? null,
        feedbackComment: t.feedback?.comment ?? null,
        feedbackAt: date(t.feedback?.at),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: tickets.id });

  // Conversations, only for tickets that were just added
  const added = new Set(inserted.map((t) => t.id));
  const lines = exampleTickets
    .filter((t) => added.has(t.id))
    .flatMap((t) =>
      t.messages.map((m) => ({
        ticketId: t.id,
        kind: m.kind,
        authorName: m.author,
        body: m.body,
        createdAt: date(m.at),
      })),
    );
  if (lines.length) await db.insert(messages).values(lines);
  console.log(
    `✓ Example tickets: ${exampleTickets.length} (${added.size} new, ${lines.length} messages)`,
  );

  // ----- Knowledge Base -----
  // Only if there are no answers yet, so running this again doesn't
  // add them twice
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(answers);
  if (count === 0) {
    await db.insert(answers).values(
      exampleAnswers.map((a) => ({
        title: a.title,
        problem: a.problem,
        solution: a.solution,
        keywords: a.keywords,
        departmentId: departmentIds.has(a.department) ? a.department : null,
        authorName: a.author,
        source: a.source,
        uses: a.uses,
        createdAt: date(a.createdAt),
        updatedAt: date(a.updatedAt),
      })),
    );
    console.log(`✓ Example Knowledge Base answers: ${exampleAnswers.length}`);
  } else {
    console.log("✓ Knowledge Base already has answers, left alone");
  }

  // New customers and tickets carry on numbering after the highest ones
  await db.execute(
    sql`select setval(pg_get_serial_sequence('customers', 'id'), (select max(id) from customers))`,
  );
  await db.execute(
    sql`select setval(pg_get_serial_sequence('tickets', 'id'), (select max(id) from tickets))`,
  );
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
