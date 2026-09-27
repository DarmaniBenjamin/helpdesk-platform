// The team: staff and customer portal logins, your own profile, invites
// and departments. Everything here reads and writes the database, and
// checks the access level of whoever is asking (see permissions.js).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  users,
  userDepartments,
  departments,
  tokens,
  customers,
} from "./db/schema.js";
import {
  hashToken,
  newToken,
  publicUser,
  requireAuth,
  requireRole,
  startSession,
} from "./auth.js";
import { ADMINS, STAFF, canManage, pickableRoles } from "./permissions.js";
import {
  BadInput,
  cleanEmail,
  cleanPassword,
  cleanPhoto,
  cleanText,
} from "./validate.js";

const INVITE_DAYS = 7;

// ---------- Helpers ----------

// Everyone's departments at once: { userId: ["managed", "support"], ... }
async function departmentsByUser(userIds) {
  if (userIds.length === 0) return {};
  const rows = await db
    .select()
    .from(userDepartments)
    .where(inArray(userDepartments.userId, userIds));
  const map = {};
  for (const row of rows) (map[row.userId] ??= []).push(row.departmentId);
  return map;
}

// Only department IDs that really exist
async function cleanDepartments(value) {
  const wanted = Array.isArray(value) ? [...new Set(value.map(String))] : [];
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(inArray(departments.id, wanted));
  return rows.map((r) => r.id);
}

async function setDepartments(userId, departmentIds) {
  await db.delete(userDepartments).where(eq(userDepartments.userId, userId));
  if (departmentIds.length) {
    await db
      .insert(userDepartments)
      .values(departmentIds.map((departmentId) => ({ userId, departmentId })));
  }
}

async function findUser(id) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new BadInput("That person isn't on the team.", 404);
  return user;
}

async function emailTaken(email, exceptId) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId
        ? and(eq(users.email, email), ne(users.id, exceptId))
        : eq(users.email, email),
    );
  return Boolean(row);
}

// A fresh invite link for someone (any older link stops working).
// Also used for customer portal invites (customers.js).
export async function makeInviteToken(userId) {
  await db
    .delete(tokens)
    .where(and(eq(tokens.userId, userId), eq(tokens.purpose, "invite")));
  const { token, tokenHash } = newToken();
  await db.insert(tokens).values({
    tokenHash,
    userId,
    purpose: "invite",
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

// Finds the person an invite link belongs to, if the link still works
async function findInvite(token) {
  const [row] = await db
    .select({ user: users })
    .from(tokens)
    .innerJoin(users, eq(tokens.userId, users.id))
    .where(
      and(
        eq(tokens.tokenHash, hashToken(String(token))),
        eq(tokens.purpose, "invite"),
        gt(tokens.expiresAt, new Date()),
      ),
    );
  if (!row || row.user.status !== "invited") return null;
  return row.user;
}

// ================================================================
// The team list:  /api/team
// ================================================================

export const teamRouter = Router();

// Everyone on the team. Admins see everyone, including invites and
// customer portal logins. Agents only need the active staff (for the
// "Assigned to" lists).
teamRouter.get("/", requireRole(...STAFF), async (req, res) => {
  const isAdmin = ADMINS.includes(req.user.role);
  const list = await db
    .select()
    .from(users)
    .where(
      isAdmin
        ? undefined
        : and(inArray(users.role, STAFF), eq(users.status, "active")),
    )
    .orderBy(asc(users.createdAt));
  const depts = await departmentsByUser(list.map((u) => u.id));
  res.json(
    await Promise.all(list.map((u) => publicUser(u, depts[u.id] ?? []))),
  );
});

// Invite someone new. Returns the invite link's token, so the Admin can
// copy the link (until invite emails are set up).
teamRouter.post("/invite", requireRole(...ADMINS), async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const name = cleanText(req.body?.name, { label: "Name" });
  const title = cleanText(req.body?.title, { label: "Job title" });
  const role = String(req.body?.role ?? "agent");
  if (!pickableRoles(req.user.role).includes(role))
    throw new BadInput("You can't give that access level.", 403);
  if (await emailTaken(email))
    throw new BadInput("Someone with this email is already on the team.", 409);

  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      title,
      role,
      status: "invited",
      invitedAt: new Date(),
    })
    .returning();
  const departmentIds = await cleanDepartments(req.body?.departments);
  await setDepartments(user.id, departmentIds);
  const token = await makeInviteToken(user.id);

  res
    .status(201)
    .json({ member: await publicUser(user, departmentIds), token });
});

// A new invite link for someone who hasn't signed up yet (Resend, or
// Copy invite link). The old link stops working.
teamRouter.post(
  "/:id/invite-link",
  requireRole(...ADMINS),
  async (req, res) => {
    const user = await findUser(req.params.id);
    if (!canManage(req.user, user))
      throw new BadInput("You can't manage this person.", 403);
    if (user.status !== "invited")
      throw new BadInput("This person has already set up their account.");

    const token = await makeInviteToken(user.id);
    const [updated] = await db
      .update(users)
      .set({ invitedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    res.json({ member: await publicUser(updated), token });
  },
);

// Change someone's name, job title, access level or departments
teamRouter.patch("/:id", requireRole(...ADMINS), async (req, res) => {
  const user = await findUser(req.params.id);
  if (!canManage(req.user, user))
    throw new BadInput("You can't change this person.", 403);

  const changes = {};
  if ("name" in req.body)
    changes.name = cleanText(req.body.name, {
      label: "Name",
      required: user.status === "active",
    });
  if ("title" in req.body)
    changes.title = cleanText(req.body.title, { label: "Job title" });
  if ("role" in req.body && user.role !== "customer") {
    const role = String(req.body.role);
    if (!pickableRoles(req.user.role).includes(role))
      throw new BadInput("You can't give that access level.", 403);
    changes.role = role;
  }

  const [updated] = Object.keys(changes).length
    ? await db
        .update(users)
        .set(changes)
        .where(eq(users.id, user.id))
        .returning()
    : [user];
  if ("departments" in req.body)
    await setDepartments(user.id, await cleanDepartments(req.body.departments));
  res.json(await publicUser(updated));
});

// Remove someone from the team (or cancel their invite). Their sign-ins
// and links stop working straight away.
teamRouter.delete("/:id", requireRole(...ADMINS), async (req, res) => {
  const user = await findUser(req.params.id);
  if (!canManage(req.user, user))
    throw new BadInput("You can't remove this person.", 403);
  await db.delete(users).where(eq(users.id, user.id));
  res.json({ ok: true });
});

// ================================================================
// Your own profile:  /api/me
// ================================================================

export const meRouter = Router();

meRouter.patch("/", requireAuth, async (req, res) => {
  const changes = {};
  if ("name" in req.body)
    changes.name = cleanText(req.body.name, { label: "Name", required: true });
  if ("phone" in req.body)
    changes.phone = cleanText(req.body.phone, { label: "Phone", max: 40 });
  if ("photo" in req.body) changes.photo = cleanPhoto(req.body.photo);
  if ("email" in req.body) {
    changes.email = cleanEmail(req.body.email);
    if (await emailTaken(changes.email, req.user.id))
      throw new BadInput("Someone else already uses this email.", 409);
  }

  // A customer's email also can't belong to a different customer
  if (changes.email && req.user.customerId) {
    const [other] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          sql`(${customers.email} = ${changes.email} or ${changes.email} = any(${customers.extraEmails}))`,
          ne(customers.id, req.user.customerId),
        ),
      );
    if (other) throw new BadInput("Someone else already uses this email.", 409);
  }

  const [updated] = Object.keys(changes).length
    ? await db
        .update(users)
        .set(changes)
        .where(eq(users.id, req.user.id))
        .returning()
    : [req.user];

  // A customer's name, email and phone also live on their customer
  // record, so keep the two the same
  if (req.user.customerId) {
    await db
      .update(customers)
      .set({ name: updated.name, email: updated.email, phone: updated.phone })
      .where(eq(customers.id, req.user.customerId));
  }
  res.json(await publicUser(updated));
});

// ================================================================
// Accepting an invite:  /api/invites/<token>
// ================================================================

export const inviteRouter = Router();

// What the welcome page shows: who the invite is for
inviteRouter.get("/:token", async (req, res) => {
  const user = await findInvite(req.params.token);
  if (!user)
    throw new BadInput("This invite link has expired or was cancelled.", 404);
  res.json({
    email: user.email,
    name: user.name,
    title: user.title,
    role: user.role,
  });
});

// The person picks their name and password, and is signed straight in
inviteRouter.post("/:token/accept", async (req, res) => {
  const user = await findInvite(req.params.token);
  if (!user)
    throw new BadInput("This invite link has expired or was cancelled.", 404);
  const name = cleanText(req.body?.name, { label: "Name", required: true });
  const password = cleanPassword(req.body?.password);

  const now = new Date();
  const [updated] = await db
    .update(users)
    .set({
      name,
      passwordHash: await bcrypt.hash(password, 12),
      status: "active",
      joinedAt: now,
      lastActiveAt: now,
    })
    .where(eq(users.id, user.id))
    .returning();
  // The link has been used, so it stops working
  await db
    .delete(tokens)
    .where(and(eq(tokens.userId, user.id), eq(tokens.purpose, "invite")));
  // A customer's name also lives on their customer record
  if (user.customerId) {
    await db
      .update(customers)
      .set({ name })
      .where(eq(customers.id, user.customerId));
  }

  await startSession(res, user.id);
  res.json({ user: await publicUser(updated) });
});

// ================================================================
// Departments:  /api/departments
// ================================================================

export const departmentsRouter = Router();

async function departmentNameTaken(name, exceptId) {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(
      exceptId
        ? and(
            sql`lower(${departments.name}) = lower(${name})`,
            ne(departments.id, exceptId),
          )
        : sql`lower(${departments.name}) = lower(${name})`,
    );
  return Boolean(row);
}

departmentsRouter.get("/", requireAuth, async (req, res) => {
  const list = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .orderBy(asc(departments.createdAt), asc(departments.name));
  res.json(list);
});

departmentsRouter.post("/", requireRole(...ADMINS), async (req, res) => {
  const name = cleanText(req.body?.name, {
    label: "Department name",
    max: 60,
    required: true,
  });
  if (await departmentNameTaken(name))
    throw new BadInput("There's already a department with that name.", 409);
  const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [created] = await db
    .insert(departments)
    .values({ id, name })
    .returning({ id: departments.id, name: departments.name });
  res.status(201).json(created);
});

departmentsRouter.patch("/:id", requireRole(...ADMINS), async (req, res) => {
  const name = cleanText(req.body?.name, {
    label: "Department name",
    max: 60,
    required: true,
  });
  if (await departmentNameTaken(name, req.params.id))
    throw new BadInput("There's already a department with that name.", 409);
  const [updated] = await db
    .update(departments)
    .set({ name })
    .where(eq(departments.id, req.params.id))
    .returning({ id: departments.id, name: departments.name });
  if (!updated) throw new BadInput("That department doesn't exist.", 404);
  res.json(updated);
});

// People are taken off it automatically, and anything else using it
// goes back to "no department" (set up in the database tables)
departmentsRouter.delete("/:id", requireRole(...ADMINS), async (req, res) => {
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(departments);
  if (count <= 1) throw new BadInput("You need at least one department.");
  await db.delete(departments).where(eq(departments.id, req.params.id));
  res.json({ ok: true });
});
