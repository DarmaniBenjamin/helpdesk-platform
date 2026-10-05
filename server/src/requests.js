// The public request form: anyone can send a request without signing
// in, e.g. from a form on your company website (it's embedded there
// with an iframe, see RequestForm.jsx). It works like a "Contact
// support" page: name, email, subject, what's wrong, Send.
//
//   POST /api/requests   { name, email, phone, company, subject,
//                          description, website }
//
// The request becomes a ticket, like one from the customer portal:
// Medium priority, no team, nobody assigned, source "website". The
// person is matched to an existing customer by email (their main or an
// extra email); if there isn't one, a new customer is made. Their
// existing details are never changed by someone filling in the form.
// Assignment rules, automations and the Admins' "New ticket"
// notification all run, the same as for any new ticket.
//
// Protection against abuse, since anyone can send it:
//   - "website" is a hidden field people never see. Spam robots fill in
//     every field they find, so if it has anything in it, the request
//     is quietly dropped (the robot is still told "thanks").
//   - Each internet address can send at most 5 requests an hour.
import { Router } from "express";
import { eq, or, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { customers, messages, tickets } from "./db/schema.js";
import { BadInput, cleanEmail, cleanText } from "./validate.js";
import { emailRequestReceived } from "./notices.js";
import { getSla } from "./sla.js";
import { recordEvent } from "./activity.js";
import { afterTicketEvent } from "./automation.js";
import { onTicketCreated } from "./notify.js";
import { sendToEveryone } from "./live.js";

export const requestsRouter = Router();

const HOUR = 60 * 60 * 1000;
const PER_HOUR = 5;

// How many requests each internet address sent in the last hour
const recent = new Map(); // address -> [times]
function tooMany(address) {
  const now = Date.now();
  const times = (recent.get(address) ?? []).filter((t) => now - t < HOUR);
  if (times.length >= PER_HOUR) {
    recent.set(address, times);
    return true;
  }
  times.push(now);
  recent.set(address, times);
  return false;
}
// Forget old addresses now and then, so the list doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [address, times] of recent) {
    if (times.every((t) => now - t >= HOUR)) recent.delete(address);
  }
}, HOUR).unref();

requestsRouter.post("/", async (req, res) => {
  const body = req.body ?? {};

  // The hidden field was filled in: a robot. Pretend it worked.
  if (String(body.website ?? "").trim()) {
    return res.status(201).json({ ok: true, ticketId: null });
  }
  if (tooMany(req.ip))
    throw new BadInput(
      "You've sent a few requests already. Please wait a while before sending another, or give us a call.",
      429,
    );

  const name = cleanText(body.name, {
    label: "Your name",
    max: 100,
    required: true,
  });
  const email = cleanEmail(body.email);
  const phone = cleanText(body.phone, { label: "Phone", max: 40 });
  const company = cleanText(body.company, { label: "Company", max: 100 });
  const subject = cleanText(body.subject, {
    label: "Subject",
    max: 200,
    required: true,
  });
  const description = cleanText(body.description, {
    label: "Description",
    max: 20000,
    required: true,
  });

  // Who it's from: an existing customer with this email, or a new one
  let [customer] = await db
    .select()
    .from(customers)
    .where(
      or(
        eq(customers.email, email),
        sql`${email} = any(${customers.extraEmails})`,
      ),
    )
    .limit(1);
  if (!customer) {
    [customer] = await db
      .insert(customers)
      .values({ name, email, phone, company: company || null })
      .returning();
  }

  // The same due times as a request from the customer portal
  const sla = await getSla();
  const priority = 2; // Medium, until the team looks at it
  const now = new Date();
  const [ticket] = await db
    .insert(tickets)
    .values({
      subject,
      description,
      status: "open",
      priority,
      departmentId: null,
      customerId: customer.id,
      source: "website",
      firstResponseDue: new Date(
        now.getTime() + sla[priority].firstResponse * HOUR,
      ),
      dueBy: new Date(now.getTime() + sla[priority].resolve * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Their message, with any phone number they gave (useful if they're a
  // customer already, since their saved details aren't changed)
  const extras = [phone && `Phone: ${phone}`, company && `Company: ${company}`]
    .filter(Boolean)
    .join("\n");
  await db.insert(messages).values({
    ticketId: ticket.id,
    kind: "customer",
    authorId: null,
    authorName: name,
    body: extras ? `${description}\n\n${extras}` : description,
    createdAt: now,
  });
  await recordEvent({
    ticket,
    actor: { id: null, name },
    type: "created",
    body: "sent this request from the website form",
    at: new Date(now.getTime() + 1),
  });

  // Assignment rules, automations, and the Admins' notification
  await afterTicketEvent(ticket.id, "created");
  onTicketCreated(ticket, name, { id: null });
  // Everyone's Inbox shows it straight away
  sendToEveryone("changed", {
    resource: "tickets",
    id: ticket.id,
    customerId: customer.id,
  });

  // "We got your request #123" to them, from the company mailbox (if
  // there is one; see notices.js). Their reply to it lands on the ticket.
  emailRequestReceived(req, {
    name,
    email,
    ticketId: ticket.id,
    subject: ticket.subject,
  }).catch(() => {});

  res.status(201).json({ ok: true, ticketId: ticket.id });
});
