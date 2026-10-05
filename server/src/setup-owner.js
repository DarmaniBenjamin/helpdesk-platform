// The first Super Admin, made on the /setup page, for a new server set up
// with deploy/install.sh (which leaves SUPER_ADMIN_* out of server/.env).
//
// The install script puts a random SETUP_CODE in server/.env and prints a
// link with it: http://<server IP>/setup/<code>. Only that link works, and
// only while there's no Super Admin yet, so nobody who finds the bare IP
// can make themselves the Super Admin first.
//
//   GET  /api/setup-owner/:code   { needed } is the link still good?
//   POST /api/setup-owner/:code   { name, email, password } → signed in
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";
import { publicUser, startSession } from "./auth.js";
import { BadInput, cleanEmail, cleanPassword, cleanText } from "./validate.js";

export const setupOwnerRouter = Router();

// Is there already a Super Admin who can sign in?
async function hasOwner() {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.status, "active")))
    .limit(1);
  return Boolean(owner);
}

// The link's code, checked in a way that takes the same time either way
function codeMatches(code) {
  const expected = process.env.SETUP_CODE?.trim();
  if (!expected || expected.length < 16) return false;
  const given = Buffer.from(String(code ?? ""));
  const wanted = Buffer.from(expected);
  return (
    given.length === wanted.length && crypto.timingSafeEqual(given, wanted)
  );
}

async function check(code) {
  if (!codeMatches(code))
    throw new BadInput(
      "This setup link isn't right. Use the one the install script printed.",
      404,
    );
  if (await hasOwner())
    throw new BadInput(
      "This helpdesk already has a Super Admin. Sign in instead.",
      409,
    );
}

setupOwnerRouter.get("/:code", async (req, res) => {
  await check(req.params.code);
  res.json({ needed: true });
});

setupOwnerRouter.post("/:code", async (req, res) => {
  await check(req.params.code);
  const name = cleanText(req.body?.name, {
    label: "Name",
    required: true,
    max: 100,
  });
  const email = cleanEmail(req.body?.email);
  const password = cleanPassword(req.body?.password);
  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({
      name,
      email,
      role: "owner",
      status: "active",
      passwordHash,
      joinedAt: now,
      lastActiveAt: now,
    })
    .onConflictDoUpdate({
      // Someone with this email already exists (e.g. invited earlier):
      // they become the Super Admin
      target: users.email,
      set: {
        name,
        role: "owner",
        status: "active",
        passwordHash,
        joinedAt: now,
      },
    })
    .returning();
  await startSession(res, user.id);
  res.status(201).json({ user: await publicUser(user) });
});
