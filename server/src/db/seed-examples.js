// FOR DEVELOPMENT ONLY. Puts the app's example data into the database:
// the 48 example customers, 170 example tickets (with their
// conversations and ratings), 5 Knowledge Base answers, 4 assignment
// rules and 4 automations, so every page has something to show while you
// build and test.
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
  rules,
  automations,
} from "./schema.js";
// The example data the front end used to make up (src/data.js)
import {
  customers as exampleCustomers,
  tickets as exampleTickets,
} from "../../../src/data.js";
import { STARTING_ANSWERS as exampleAnswers } from "../../../src/Components/Knowledge.js";

const date = (ms) => (ms ? new Date(ms) : null);

const EXAMPLE_RULES = [
  {
    name: "Website and design",
    description:
      "Website changes, flyers, logos and social media go to Web + Media.",
    keywords: ["website", "flyer", "logo", "social media"],
    departmentId: "media",
    enabled: true,
  },
  {
    name: "Network problems",
    description: "Wi-Fi and internet problems go to Support.",
    keywords: ["wi-fi", "wifi", "internet", "access point"],
    departmentId: "support",
    enabled: true,
  },
  {
    name: "Email and accounts",
    description:
      "Mailboxes, OneDrive and Microsoft 365 go to Managed Services.",
    keywords: ["mailbox", "onedrive", "microsoft 365", "outlook"],
    departmentId: "managed",
    enabled: true,
  },
  {
    name: "Backups and servers",
    description: "Failed backups, restores and server space warnings.",
    keywords: ["backup", "restore", "server"],
    departmentId: "managed",
    enabled: false,
  },
];

const EXAMPLE_AUTOMATIONS = [
  {
    name: "Auto-close resolved tickets",
    description:
      "Close tickets that have been resolved for 7 days without a customer reply.",
    trigger: { type: "resolvedFor", value: 7 },
    actions: [
      { type: "setStatus", value: "closed" },
      {
        type: "emailCustomer",
        value: "We've closed your ticket. Just reply if you still need help.",
      },
    ],
    enabled: true,
  },
  {
    name: "Welcome email for new tickets",
    description:
      "Let customers know we got their request as soon as a ticket is created.",
    trigger: { type: "created", value: null },
    actions: [
      {
        type: "emailCustomer",
        value:
          "Thanks, we've received your request and will be in touch shortly.",
      },
      { type: "addTag", value: "new" },
    ],
    enabled: true,
  },
  {
    name: "Priority escalation",
    description: "Raise the priority if nobody has replied within 4 hours.",
    trigger: { type: "noAgentReply", value: 4 },
    actions: [
      { type: "setPriority", value: 4 },
      { type: "notifyTeam", value: null },
      {
        type: "addNote",
        value: "Escalated automatically: no reply within 4 hours.",
      },
    ],
    enabled: true,
  },
  {
    name: "Reopen when the customer replies",
    description:
      "If a customer answers a ticket we're waiting on, put it back in the queue.",
    trigger: { type: "customerReply", value: null },
    actions: [{ type: "setStatus", value: "open" }],
    enabled: false,
  },
];

// How many rows a table has
async function countOf(table) {
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(table);
  return count;
}

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
  if ((await countOf(answers)) === 0) {
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

  // ----- Assignment rules and automations -----
  // Only if there are none yet, like the answers
  if ((await countOf(rules)) === 0) {
    await db.insert(rules).values(
      EXAMPLE_RULES.map((r) => ({
        ...r,
        departmentId: departmentIds.has(r.departmentId) ? r.departmentId : null,
      })),
    );
    console.log(`✓ Example assignment rules: ${EXAMPLE_RULES.length}`);
  } else {
    console.log("✓ Assignment rules already there, left alone");
  }
  if ((await countOf(automations)) === 0) {
    await db.insert(automations).values(EXAMPLE_AUTOMATIONS);
    console.log(`✓ Example automations: ${EXAMPLE_AUTOMATIONS.length}`);
  } else {
    console.log("✓ Automations already there, left alone");
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
