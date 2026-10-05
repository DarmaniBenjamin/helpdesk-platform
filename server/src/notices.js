// The emails the helpdesk sends by itself, from the company mailbox
// (Integrations → Email, see email.js):
//   - invites: to new team members and to customers given the portal
//   - "forgot password": a link to choose a new password
//   - "we got your request": to whoever sends the website form
// With no company mailbox set, nothing is sent: invite links can still
// be copied from the page and sent another way.
//
// Also the "forgot password" routes:
//   POST /api/password/forgot          { email } → always the same answer
//   GET  /api/password/reset/:token    is the link still good? { email }
//   POST /api/password/reset/:token    { password } → new password, signed in
import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db/index.js";
import { sessions, tokens, users } from "./db/schema.js";
import { hashToken, newToken, publicUser, startSession } from "./auth.js";
import { BadInput, cleanEmail, cleanPassword } from "./validate.js";
import { sendSystemEmail } from "./email.js";

const APP_NAME = "Uplink";
const HOUR = 60 * 60 * 1000;

// The site's own address, as the person sending the request sees it,
// e.g. https://uplinkdarmani.mooo.com (links in emails go there)
export const siteAddress = (req) => `${req.protocol}://${req.get("host")}`;

// ---------- Invites ----------

// Emails an invite link. Returns { sent, why } (see sendSystemEmail).
export function emailInvite(req, user, token) {
  const link = `${siteAddress(req)}/welcome/${token}`;
  const customer = user.role === "customer";
  const hello = user.name ? `Hi ${user.name.split(" ")[0]},` : "Hi,";
  return sendSystemEmail({
    to: user.email,
    subject: customer
      ? `Your access to the ${APP_NAME} customer portal`
      : `You're invited to join ${APP_NAME}`,
    text: [
      hello,
      "",
      customer
        ? `${req.user.name} has given you access to our customer portal, where you can send support requests and follow them.`
        : `${req.user.name} has invited you to join the team on ${APP_NAME}.`,
      "",
      "Open this link to choose your password and get started:",
      link,
      "",
      "The link works once, for 7 days.",
    ].join("\n"),
  });
}

// ---------- Website form: "we got your request" ----------

export function emailRequestReceived(req, { name, email, ticketId, subject }) {
  return sendSystemEmail({
    to: email,
    ticketId,
    subject: `We got your request: ${subject} [#${ticketId}]`,
    text: [
      `Hi ${name.split(" ")[0]},`,
      "",
      `Thanks for getting in touch. Your request is number #${ticketId}, and our team will get back to you soon.`,
      "",
      `Your request: ${subject}`,
      "",
      "If you need to add anything, just reply to this email.",
    ].join("\n"),
  });
}

// ---------- Forgot password ----------

export const passwordRouter = Router();

// Slows down anyone asking for lots of links: 5 per email per hour
const asked = new Map();
function askedTooOften(email) {
  const now = Date.now();
  const recent = (asked.get(email) ?? []).filter((t) => now - t < HOUR);
  recent.push(now);
  asked.set(email, recent);
  return recent.length > 5;
}

// Emails a link to choose a new password, if there's an account with
// that email. Always the same answer, so nobody can use this to find out
// which emails have accounts.
passwordRouter.post("/forgot", async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const done = () => res.json({ ok: true });
  if (askedTooOften(email)) return done();

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.status, "active")));
  if (!user) return done();

  // One link at a time: a new one replaces the last
  await db
    .delete(tokens)
    .where(and(eq(tokens.userId, user.id), eq(tokens.purpose, "reset")));
  const { token, tokenHash } = newToken();
  await db.insert(tokens).values({
    tokenHash,
    userId: user.id,
    purpose: "reset",
    expiresAt: new Date(Date.now() + HOUR),
  });
  const result = await sendSystemEmail({
    to: user.email,
    subject: `Choose a new ${APP_NAME} password`,
    text: [
      user.name ? `Hi ${user.name.split(" ")[0]},` : "Hi,",
      "",
      "Someone (hopefully you) asked to reset your password. Open this link to choose a new one:",
      `${siteAddress(req)}/reset/${token}`,
      "",
      "The link works once, for 1 hour. If you didn't ask for this, you can ignore this email: your password stays the same.",
    ].join("\n"),
  });
  if (!result.sent)
    console.warn(`Password reset for ${email} not emailed: ${result.why}`);
  done();
});

async function findReset(token) {
  const [row] = await db
    .select({ user: users })
    .from(tokens)
    .innerJoin(users, eq(tokens.userId, users.id))
    .where(
      and(
        eq(tokens.tokenHash, hashToken(String(token))),
        eq(tokens.purpose, "reset"),
        gt(tokens.expiresAt, new Date()),
        eq(users.status, "active"),
      ),
    );
  if (!row)
    throw new BadInput(
      "This link has expired or was already used. Ask for a new one.",
      404,
    );
  return row.user;
}

passwordRouter.get("/reset/:token", async (req, res) => {
  const user = await findReset(req.params.token);
  res.json({ email: user.email });
});

// The new password. Signs them out everywhere else (in case someone else
// had their old one), and in here.
passwordRouter.post("/reset/:token", async (req, res) => {
  const user = await findReset(req.params.token);
  const password = cleanPassword(req.body?.password);
  const [updated] = await db
    .update(users)
    .set({
      passwordHash: await bcrypt.hash(password, 12),
      lastActiveAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();
  await db
    .delete(tokens)
    .where(and(eq(tokens.userId, user.id), eq(tokens.purpose, "reset")));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await startSession(res, user.id);
  res.json({ user: await publicUser(updated) });
});
