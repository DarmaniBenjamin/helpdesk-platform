// Test data in bulk, to see how the helpdesk copes with lots of tickets.
//
//   npm run db:demo              100 tickets (with 20 customers)
//   npm run db:demo -- 10000     10,000 tickets (with 2,000 customers)
//   npm run db:demo -- remove    removes all of it again
//
// Every test customer has an email ending in @demo.uplink.test, which is
// how "remove" finds them: it deletes those customers and their tickets
// (with their messages), and nothing else. Tickets get a spread of
// statuses, priorities, departments, agents, dates over the last six
// months, a few messages each, and star ratings on some finished ones,
// so the Dashboard, Reports and Performance pages have something to show.
//
// Don't run this on the real site's database once customers use it: use
// it on a test copy (your laptop, or a test server).
import { inArray, like, sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import { customers, departments, messages, tickets, users } from "./schema.js";

const DOMAIN = "demo.uplink.test";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const FIRST = [
  "Aaliyah",
  "Marcus",
  "Keisha",
  "Andre",
  "Shanice",
  "Devon",
  "Tamara",
  "Jerome",
  "Nadia",
  "Kemar",
  "Alicia",
  "Tyrone",
  "Renee",
  "Malik",
  "Simone",
  "Jason",
  "Crystal",
  "Damian",
  "Monique",
  "Kevin",
];
const LAST = [
  "Charles",
  "Joseph",
  "Thomas",
  "Williams",
  "Francis",
  "Alexander",
  "Phillip",
  "George",
  "James",
  "Noel",
  "Mitchell",
  "Baptiste",
  "Antoine",
  "Roberts",
  "Benjamin",
  "Lewis",
  "Peters",
  "Edwards",
  "Andrew",
  "Mark",
];
const COMPANIES = [
  "Spice Isle Traders",
  "Grand Anse Dental",
  "Carenage Shipping",
  "Belmont Estates",
  "Morne Rouge Hotel",
  "St. George's Law",
  "Lagoon Road Motors",
  "True Blue Bay Resort",
  null,
  null,
  null,
];
const PROBLEMS = [
  [
    "Printer won't print",
    "The office printer shows offline and nothing prints since this morning.",
  ],
  [
    "Email not syncing on phone",
    "Outlook on my iPhone stopped getting new emails yesterday.",
  ],
  [
    "Wifi slow in the back office",
    "The wifi in the back office keeps dropping and is very slow.",
  ],
  [
    "Can't log in to the shared drive",
    "When I open the S: drive it asks for a password and won't accept mine.",
  ],
  [
    "New laptop setup",
    "We have a new staff member starting Monday who needs a laptop set up.",
  ],
  [
    "CCTV camera offline",
    "Camera 3 in the parking lot shows no signal on the recorder.",
  ],
  [
    "Password reset needed",
    "I'm locked out of my Microsoft 365 account after too many tries.",
  ],
  [
    "Computer very slow",
    "My desktop takes ten minutes to start and programs freeze.",
  ],
  [
    "Website contact form not working",
    "Customers say the form on our website gives an error.",
  ],
  [
    "Backup failed notification",
    "We got an email saying last night's backup failed.",
  ],
  [
    "Phone extension not ringing",
    "Calls to extension 204 go straight to voicemail.",
  ],
  [
    "Install accounting software",
    "Please install the new version of our accounting software on two PCs.",
  ],
];
const REPLIES = [
  "Thanks for letting us know. Could you restart it and tell us if that helps?",
  "We've connected remotely and are looking into it now.",
  "A technician will come by this afternoon.",
  "That should be fixed now. Can you check on your side?",
  "We've ordered the replacement part, it should arrive this week.",
];
const CUSTOMER_REPLIES = [
  "Still the same, unfortunately.",
  "Yes, that worked, thank you!",
  "Can someone come by tomorrow morning?",
  "It's working again now.",
];
const NOTES = [
  "Checked the router logs, looks like a DHCP issue.",
  "Spoke with them on the phone, they'll send a photo of the error.",
  "Driver reinstalled, monitoring for a day.",
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;

async function remove() {
  const demo = await db
    .select({ id: customers.id })
    .from(customers)
    .where(like(customers.email, `%@${DOMAIN}`));
  const ids = demo.map((c) => c.id);
  let removed = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const part = ids.slice(i, i + 1000);
    const gone = await db
      .delete(tickets)
      .where(inArray(tickets.customerId, part))
      .returning({ id: tickets.id });
    removed += gone.length;
    await db.delete(customers).where(inArray(customers.id, part));
  }
  // The next ticket number follows the highest one left
  await db.execute(
    sql`select setval(pg_get_serial_sequence('tickets', 'id'), coalesce((select max(id) from tickets), 0) + 1, false)`,
  );
  console.log(
    `Removed ${removed} test tickets and ${ids.length} test customers.`,
  );
}

async function create(count) {
  const started = Date.now();
  const teams = (await db.select({ id: departments.id }).from(departments)).map(
    (d) => d.id,
  );
  const staff = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["owner", "admin", "agent"]));
  const stamp = Date.now().toString(36);

  // Customers: one for every five tickets
  const customerCount = Math.max(5, Math.ceil(count / 5));
  const newCustomers = [];
  for (let i = 0; i < customerCount; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    newCustomers.push({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}.${stamp}${i}@${DOMAIN}`,
      phone: `473-${400 + (i % 600)}-${String(1000 + (i % 9000)).padStart(4, "0")}`,
      company: pick(COMPANIES),
    });
  }
  const customerRows = [];
  for (let i = 0; i < newCustomers.length; i += 1000) {
    customerRows.push(
      ...(await db
        .insert(customers)
        .values(newCustomers.slice(i, i + 1000))
        .returning({ id: customers.id, name: customers.name })),
    );
  }

  // Tickets, in batches of 500, each with a few messages
  let made = 0;
  for (let start = 0; start < count; start += 500) {
    const batch = [];
    for (let i = start; i < Math.min(count, start + 500); i++) {
      const [subject, description] = pick(PROBLEMS);
      const customer = pick(customerRows);
      const createdAt = new Date(Date.now() - Math.random() * 180 * DAY);
      const ageDays = (Date.now() - createdAt) / DAY;
      // Older tickets are mostly finished
      const status =
        ageDays > 14
          ? pick(["closed", "closed", "resolved", "closed", "open"])
          : pick(["open", "open", "pending", "waiting", "resolved"]);
      const done = status === "resolved" || status === "closed";
      const priority = pick([1, 2, 2, 2, 3, 3, 4]);
      const assignee = chance(0.85) && staff.length ? pick(staff) : null;
      const resolvedAt = done
        ? new Date(createdAt.getTime() + (1 + Math.random() * 72) * HOUR)
        : null;
      const rated = done && chance(0.4);
      batch.push({
        ticket: {
          subject,
          description,
          status,
          priority,
          departmentId: teams.length ? pick(teams) : null,
          assigneeId: assignee?.id ?? null,
          customerId: customer.id,
          source: pick(["email", "email", "portal", "agent", "website"]),
          createdAt,
          updatedAt: resolvedAt ?? new Date(createdAt.getTime() + 2 * HOUR),
          firstResponseDue: new Date(createdAt.getTime() + 4 * HOUR),
          dueBy: new Date(createdAt.getTime() + (24 + priority * 12) * HOUR),
          firstRespondedAt:
            assignee && chance(0.9)
              ? new Date(createdAt.getTime() + Math.random() * 6 * HOUR)
              : null,
          resolvedAt,
          closedAt: status === "closed" ? resolvedAt : null,
          feedbackRating: rated ? pick([3, 4, 4, 5, 5, 5, 2]) : null,
          feedbackComment:
            rated && chance(0.4)
              ? pick([
                  "Quick and helpful!",
                  "Took a while, but fixed.",
                  "Great service as always.",
                ])
              : null,
          feedbackAt: rated ? resolvedAt : null,
        },
        customer,
        assignee,
      });
    }
    const inserted = await db
      .insert(tickets)
      .values(batch.map((b) => b.ticket))
      .returning({ id: tickets.id, createdAt: tickets.createdAt });

    const allMessages = [];
    inserted.forEach((t, i) => {
      const { customer, assignee } = batch[i];
      const agentName = assignee?.name || "Support";
      let at = t.createdAt.getTime();
      const step = () => new Date((at += (0.2 + Math.random() * 6) * HOUR));
      allMessages.push({
        ticketId: t.id,
        kind: "customer",
        authorName: customer.name,
        body: batch[i].ticket.description,
        createdAt: t.createdAt,
      });
      const extra = Math.floor(Math.random() * 5);
      for (let k = 0; k < extra; k++) {
        const kind = pick(["agent", "agent", "customer", "note"]);
        allMessages.push({
          ticketId: t.id,
          kind,
          authorId: kind === "customer" ? null : (assignee?.id ?? null),
          authorName: kind === "customer" ? customer.name : agentName,
          body:
            kind === "agent"
              ? pick(REPLIES)
              : kind === "note"
                ? pick(NOTES)
                : pick(CUSTOMER_REPLIES),
          channel:
            kind === "agent"
              ? pick(["email", "whatsapp", null])
              : kind === "note"
                ? pick(["call", "onsite", null])
                : null,
          createdAt: step(),
        });
      }
    });
    for (let i = 0; i < allMessages.length; i += 2000)
      await db.insert(messages).values(allMessages.slice(i, i + 2000));
    made += inserted.length;
    process.stdout.write(`\r${made} / ${count} tickets`);
  }
  console.log(
    `\nMade ${made} test tickets and ${customerRows.length} test customers in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  console.log(`Remove them again with: npm run db:demo -- remove`);
}

const arg = process.argv[2];
try {
  if (arg === "remove") await remove();
  else {
    const count = arg ? Number(arg) : 100;
    if (!Number.isInteger(count) || count < 1 || count > 100000) {
      console.error('Give a number of tickets from 1 to 100000, or "remove".');
      process.exitCode = 1;
    } else await create(count);
  }
} finally {
  await pool.end();
}
