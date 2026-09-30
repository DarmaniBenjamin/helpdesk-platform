// Customers: the people and businesses you support. Staff can see, add
// and edit them; Admins can give a customer access to the customer
// portal, and delete customers. A customer who signs in only ever gets
// their own record.
import { Router } from "express";
import { and, asc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { customers, tickets, users } from "./db/schema.js";
import { publicUser, requireAuth, requireRole } from "./auth.js";
import { makeInviteToken } from "./team.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput, cleanEmail, cleanText } from "./validate.js";
import { filesOfTicket, removeFiles } from "./attachments.js";

export const customersRouter = Router();

// What the front end gets for a customer (dates as milliseconds)
function publicCustomer(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? "", // "" = no email yet (some Freshdesk contacts)
    phone: c.phone,
    company: c.company,
    extraEmails: c.extraEmails,
    extraPhones: c.extraPhones,
    createdAt: c.createdAt.getTime(),
  };
}

async function findCustomer(id) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, Number(id) || 0));
  if (!customer) throw new BadInput("That customer doesn't exist.", 404);
  return customer;
}

// Which other customer already uses this email (as their main email or
// an extra one)? Returns them, or undefined.
async function customerWithEmail(email, exceptId) {
  const match = or(
    eq(customers.email, email),
    sql`${email} = any(${customers.extraEmails})`,
  );
  const [row] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(exceptId ? and(match, ne(customers.id, exceptId)) : match);
  return row;
}

// A list of emails or phone numbers: cleaned, no blanks, no repeats
function cleanList(value, clean) {
  if (!Array.isArray(value)) throw new BadInput("That list isn't valid.");
  return [...new Set(value.map(clean).filter(Boolean))].slice(0, 20);
}

const cleanPhone = (value) =>
  cleanText(value, { label: "Phone number", max: 40 });

// Everyone for staff; just themselves for a signed-in customer
customersRouter.get("/", requireAuth, async (req, res) => {
  const list = STAFF.includes(req.user.role)
    ? await db.select().from(customers).orderBy(asc(customers.name))
    : req.user.customerId
      ? await db
          .select()
          .from(customers)
          .where(eq(customers.id, req.user.customerId))
      : [];
  res.json(list.map(publicCustomer));
});

// Add a customer
customersRouter.post("/", requireRole(...STAFF), async (req, res) => {
  const name = cleanText(req.body?.name, { label: "Name", required: true });
  const email = cleanEmail(req.body?.email);
  const phone = cleanPhone(req.body?.phone);
  const company = cleanText(req.body?.company, { label: "Business" }) || null;

  const owner = await customerWithEmail(email);
  if (owner) throw new BadInput(`${owner.name} already uses this email.`, 409);

  const [created] = await db
    .insert(customers)
    .values({ name, email, phone, company })
    .returning();
  res.status(201).json(publicCustomer(created));
});

// Change a customer's details. If they have a customer portal login, its
// name, email and phone are kept the same.
customersRouter.patch("/:id", requireRole(...STAFF), async (req, res) => {
  const customer = await findCustomer(req.params.id);
  const changes = {};

  if ("name" in req.body)
    changes.name = cleanText(req.body.name, { label: "Name", required: true });
  if ("company" in req.body)
    changes.company =
      cleanText(req.body.company, { label: "Business" }) || null;
  if ("phone" in req.body) changes.phone = cleanPhone(req.body.phone);
  if ("extraPhones" in req.body)
    changes.extraPhones = cleanList(req.body.extraPhones, cleanPhone);
  if ("email" in req.body) changes.email = cleanEmail(req.body.email);
  if ("extraEmails" in req.body)
    changes.extraEmails = cleanList(req.body.extraEmails, cleanEmail);

  // None of their emails can belong to another customer. (Some customers
  // imported from Freshdesk have no main email yet, hence the filter.)
  const emails = [
    changes.email ?? customer.email,
    ...(changes.extraEmails ?? customer.extraEmails),
  ].filter(Boolean);
  for (const email of emails) {
    const owner = await customerWithEmail(email, customer.id);
    if (owner) throw new BadInput(`${owner.name} already uses ${email}.`, 409);
  }

  // Their portal login (if any) signs in with the main email, which
  // can't belong to someone else who signs in
  const [login] = await db
    .select()
    .from(users)
    .where(eq(users.customerId, customer.id));
  if (login && changes.email) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, changes.email), ne(users.id, login.id)));
    if (taken)
      throw new BadInput("Someone else already signs in with this email.", 409);
  }

  const [updated] = Object.keys(changes).length
    ? await db
        .update(customers)
        .set(changes)
        .where(eq(customers.id, customer.id))
        .returning()
    : [customer];

  if (login) {
    await db
      .update(users)
      .set({ name: updated.name, email: updated.email, phone: updated.phone })
      .where(eq(users.id, login.id));
  }
  res.json(publicCustomer(updated));
});

// Give a customer access to the customer portal. Returns the invite
// link's token, like staff invites.
customersRouter.post(
  "/:id/invite",
  requireRole(...ADMINS),
  async (req, res) => {
    const customer = await findCustomer(req.params.id);
    // They sign in with their email, so they need one first
    if (!customer.email)
      throw new BadInput(
        "Add an email address for this customer first, so they can sign in.",
      );

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        or(eq(users.customerId, customer.id), eq(users.email, customer.email)),
      );
    if (existing)
      throw new BadInput(
        "This customer already has access, or someone already signs in with their email.",
        409,
      );

    const [user] = await db
      .insert(users)
      .values({
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        role: "customer",
        status: "invited",
        customerId: customer.id,
        invitedAt: new Date(),
      })
      .returning();
    const token = await makeInviteToken(user.id);
    res.status(201).json({ member: await publicUser(user, []), token });
  },
);

// Delete a customer for good (Admins and the Super Admin). Everything of
// theirs goes with them, all at once:
//   - every one of their tickets, with the whole conversation, notes,
//     history and attached files
//   - their customer portal login, if they have one
// Knowledge Base answers saved from their tickets stay, they just stop
// linking to them. Returns how many tickets were deleted.
customersRouter.delete("/:id", requireRole(...ADMINS), async (req, res) => {
  const customer = await findCustomer(req.params.id);
  const theirTickets = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.customerId, customer.id));

  // The stored names of their files, to remove from the uploads folder
  // once the records are gone
  const fileKeys = [];
  for (const t of theirTickets) fileKeys.push(...(await filesOfTicket(t.id)));

  await db.transaction(async (tx) => {
    // Messages, file records and notifications about these tickets are
    // deleted with them (set up in the database tables)
    await tx.delete(tickets).where(eq(tickets.customerId, customer.id));
    // Their portal login (and its sign-ins) goes with the customer
    await tx.delete(customers).where(eq(customers.id, customer.id));
  });
  removeFiles(fileKeys);
  res.json({ ok: true, tickets: theirTickets.length });
});
