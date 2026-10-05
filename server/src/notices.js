// The emails the helpdesk sends by itself, from the company mailbox
// (Integrations → Email, see email.js):
//   - invites: to new team members and to customers given the portal
//   - "forgot password": a link to choose a new password
//   ("we got your request" when a ticket is created: email.js)
//   - "how did we do?": when a ticket is resolved, a link to rate it
//     with 1-5 stars, no sign-in needed (can be switched off in
//     Integrations → Email)
// With no company mailbox set, nothing is sent: invite links can still
// be copied from the page and sent another way.
//
// Also the "forgot password" routes:
//   POST /api/password/forgot          { email } → always the same answer
//   GET  /api/password/reset/:token    is the link still good? { email }
//   POST /api/password/reset/:token    { password } → new password, signed in
// And the feedback page's routes (no sign-in, the link is the key):
//   GET  /api/feedback/:token          the ticket, and its rating if rated
//   POST /api/feedback/:token          { rating, comment }
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  customers,
  sessions,
  settings,
  tickets,
  tokens,
  users,
} from "./db/schema.js";
import { hashToken, newToken, publicUser, startSession } from "./auth.js";
import { BadInput, cleanEmail, cleanPassword, cleanText } from "./validate.js";
import { sign } from "./secrets.js";
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

// ---------- Feedback: "how did we do?" ----------

// A setting from the settings table (or undefined)
async function setting(key) {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value;
}
async function saveSetting(key, value) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

// The site's address, for links in emails sent by the server on its own
// (not in answer to someone, so there's no request to take it from).
// Remembered each time staff open the app (index.js calls this).
let knownSite = null;
export async function rememberSite(req) {
  const url = siteAddress(req);
  if (url === knownSite) return;
  knownSite = url;
  await saveSetting("siteAddress", { url }).catch(() => {});
}

// The link in the email: the ticket number and a signature, so it only
// works for that ticket (secrets.js)
const feedbackToken = (ticketId) =>
  `${ticketId}.${sign(`feedback:${ticketId}`)}`;

function ticketFromToken(token) {
  const [id, signature = ""] = String(token).split(".");
  const expected = sign(`feedback:${Number(id)}`);
  const ok =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok || !Number(id)) throw new BadInput("This link doesn't work.", 404);
  return Number(id);
}

// Every minute: tickets resolved (or closed) since feedback emails were
// turned on, not rated, and not asked yet, get the email. Older tickets
// (e.g. imported from Freshdesk) are never emailed.
let asking = false;
async function askForFeedback() {
  if (asking) return;
  asking = true;
  try {
    if ((await setting("feedbackEmail"))?.enabled === false) return;
    const site = (await setting("siteAddress"))?.url;
    if (!site) return; // nobody has opened the app yet
    let since = (await setting("feedbackSince"))?.at;
    if (!since) {
      since = Date.now();
      await saveSetting("feedbackSince", { at: since });
    }
    const after = new Date(since);
    const due = await db
      .select({ ticket: tickets, customer: customers })
      .from(tickets)
      .innerJoin(customers, eq(tickets.customerId, customers.id))
      .where(
        and(
          inArray(tickets.status, ["resolved", "closed"]),
          isNull(tickets.feedbackRating),
          isNull(tickets.feedbackRequestedAt),
          or(gt(tickets.resolvedAt, after), gt(tickets.closedAt, after)),
        ),
      )
      .orderBy(asc(tickets.id))
      .limit(20);

    for (const { ticket, customer } of due) {
      // Marked first, so it's never sent twice
      await db
        .update(tickets)
        .set({ feedbackRequestedAt: new Date() })
        .where(eq(tickets.id, ticket.id));
      if (!customer.email) continue; // nobody to email
      const result = await sendSystemEmail({
        to: customer.email,
        ticketId: ticket.id,
        subject: `How did we do? ${ticket.subject} [#${ticket.id}]`,
        text: [
          `Hi ${customer.name.split(" ")[0]},`,
          "",
          `Your request #${ticket.id} ("${ticket.subject}") has been resolved.`,
          "",
          "How did we do? Rating us takes a few seconds:",
          `${site}/feedback/${feedbackToken(ticket.id)}`,
          "",
          "Still not fixed? Just reply to this email and we'll pick it up again.",
        ].join("\n"),
      });
      if (!result.sent) {
        // No company mailbox (yet): try again later instead of skipping it
        if (/company mailbox/i.test(result.why ?? "")) {
          await db
            .update(tickets)
            .set({ feedbackRequestedAt: null })
            .where(eq(tickets.id, ticket.id));
          return;
        }
        console.warn(`Feedback email for #${ticket.id}: ${result.why}`);
      }
    }
  } finally {
    asking = false;
  }
}

export function startFeedbackEmails() {
  const run = () =>
    askForFeedback().catch((err) => console.error("Feedback:", err));
  setTimeout(run, 15 * 1000).unref();
  setInterval(run, 60 * 1000).unref();
}

export const feedbackRouter = Router();

async function ticketForFeedback(token) {
  const id = ticketFromToken(token);
  const [row] = await db
    .select({ ticket: tickets, customer: customers })
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(eq(tickets.id, id));
  if (!row) throw new BadInput("This link doesn't work.", 404);
  return row;
}

const publicFeedback = ({ ticket, customer }) => ({
  ticketId: ticket.id,
  subject: ticket.subject,
  name: customer.name.split(" ")[0],
  feedback: ticket.feedbackRating
    ? { rating: ticket.feedbackRating, comment: ticket.feedbackComment ?? "" }
    : null,
});

feedbackRouter.get("/:token", async (req, res) => {
  res.json(publicFeedback(await ticketForFeedback(req.params.token)));
});

// The rating, once per ticket (like the customer portal's)
feedbackRouter.post("/:token", async (req, res) => {
  const row = await ticketForFeedback(req.params.token);
  if (row.ticket.feedbackRating)
    throw new BadInput("This request has already been rated. Thank you!");
  const rating = Number(req.body?.rating);
  if (![1, 2, 3, 4, 5].includes(rating))
    throw new BadInput("Pick from 1 to 5 stars.");
  const comment = cleanText(req.body?.comment, { label: "Comment", max: 2000 });
  const [ticket] = await db
    .update(tickets)
    .set({
      feedbackRating: rating,
      feedbackComment: comment,
      feedbackAt: new Date(),
    })
    .where(eq(tickets.id, row.ticket.id))
    .returning();
  res.json(publicFeedback({ ticket, customer: row.customer }));
});
