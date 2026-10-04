// Signing in and out, with real passwords and login sessions.
//
// How it works:
// 1. You sign in with your email and password. The password is checked
//    against the scrambled copy in the database (it's never stored as-is).
// 2. The server makes a long random "session token" and puts it in a
//    cookie. The browser sends that cookie back with every request, so the
//    server knows who you are. The cookie can't be read by the page's
//    JavaScript (httpOnly), which protects it from being stolen.
// 3. Only a scrambled copy of the token is saved in the sessions table,
//    so even someone with a copy of the database can't use it.
// 4. Signing out deletes the session. Sessions also expire after 30 days.
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "./db/index.js";
import { users, sessions, userDepartments } from "./db/schema.js";

const SESSION_COOKIE = "helpdesk_session";
const SESSION_DAYS = 30;
// On the real site, the sign-in cookie is only ever sent over https.
// The one exception is signing in on the server's IP over plain http,
// which only works while no domain works yet (see caddy.js), so a site
// without a working domain can still be reached to add or fix one.
const secureCookies = process.env.NODE_ENV === "production";

// ---------- Helpers ----------

export const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// Reads one cookie from the request
function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function setSessionCookie(res, token, expires) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // the page's JavaScript can't read it
    sameSite: "lax", // not sent when another website tries to use it
    secure: secureCookies && res.req.secure,
    path: "/",
    expires,
  });
}

// What the front end is allowed to see about a person (never the
// password). Dates are sent as milliseconds, like the rest of the app.
// Pass `departmentIds` when you already have them, to save a lookup.
export async function publicUser(user, departmentIds) {
  const departments =
    departmentIds ??
    (
      await db
        .select({ id: userDepartments.departmentId })
        .from(userDepartments)
        .where(eq(userDepartments.userId, user.id))
    ).map((r) => r.id);
  const ms = (date) => (date ? date.getTime() : null);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    photo: user.photo,
    title: user.title,
    role: user.role,
    status: user.status,
    customerId: user.customerId,
    departments,
    invitedAt: ms(user.invitedAt),
    joinedAt: ms(user.joinedAt),
    lastActiveAt: ms(user.lastActiveAt),
  };
}

// Checking a wrong email should take as long as checking a wrong password,
// so nobody can tell which emails have accounts by timing the answer
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

// Makes a random token for a link or a session. The token goes to the
// person; only its scrambled copy (hash) is saved.
export function newToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

// Signs someone in: saves a new session and sets the cookie
export async function startSession(res, userId) {
  const { token, tokenHash } = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash, userId, expiresAt: expires });
  setSessionCookie(res, token, expires);
}

// ---------- Slowing down password guessing ----------
// After 10 wrong passwords for the same email from the same place,
// sign-in is blocked for 15 minutes.
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const attempts = new Map();

function isBlocked(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.since > ATTEMPT_WINDOW) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const entry = attempts.get(key) ?? { count: 0, since: Date.now() };
  entry.count += 1;
  attempts.set(key, entry);
}

// ---------- Who is signed in? ----------

// Runs on every request: if there's a valid session cookie, the signed-in
// person is put on req.user for the routes to use
export async function loadSession(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return next();

  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
      ),
    );

  if (row && row.user.status === "active") {
    req.user = row.user;
    req.sessionHash = tokenHash;
  }
  next();
}

// Put this on any route that needs someone signed in
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in." });
  next();
}

// Put this on routes only some access levels can use,
// e.g. requireRole("owner", "admin")
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in." });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "You don't have access to this." });
    next();
  };
}

// ---------- The routes: /api/auth/... ----------

export const authRouter = Router();

// Sign in
authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) {
    return res.status(400).json({ error: "Enter your email and password." });
  }

  const key = `${req.ip}|${email}`;
  if (isBlocked(key)) {
    return res.status(429).json({
      error: "Too many wrong passwords. Wait 15 minutes and try again.",
    });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const matches = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !user.passwordHash || !matches) {
    recordFailure(key);
    // The same message either way, so nobody can find out which emails
    // have accounts
    return res
      .status(401)
      .json({ error: "That email and password don't match." });
  }
  if (user.status !== "active") {
    return res.status(403).json({
      error:
        "This account isn't set up yet. Open the invite link in your email.",
    });
  }
  attempts.delete(key);

  // Tidy up: remove any of this person's sessions that have run out
  await db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, user.id), lt(sessions.expiresAt, new Date())),
    );

  // A new session
  await startSession(res, user.id);

  const now = new Date();
  await db
    .update(users)
    .set({ lastActiveAt: now })
    .where(eq(users.id, user.id));

  res.json({ user: await publicUser({ ...user, lastActiveAt: now }) });
});

// Who am I? The front end asks this when it first opens.
authRouter.get("/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in." });

  // Update "last active" at most every 5 minutes
  const now = new Date();
  if (!req.user.lastActiveAt || now - req.user.lastActiveAt > 5 * 60 * 1000) {
    await db
      .update(users)
      .set({ lastActiveAt: now })
      .where(eq(users.id, req.user.id));
    req.user.lastActiveAt = now;
  }
  res.json({ user: await publicUser(req.user) });
});

// Sign out: the session is deleted, so the cookie stops working
authRouter.post("/logout", async (req, res) => {
  if (req.sessionHash) {
    await db.delete(sessions).where(eq(sessions.tokenHash, req.sessionHash));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// Change your own password. Signs you out everywhere else.
authRouter.post("/password", requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? "");
  const next = String(req.body?.newPassword ?? "");

  if (next.length < 8) {
    return res
      .status(400)
      .json({ error: "The new password needs at least 8 characters." });
  }
  if (next.length > 200) {
    return res.status(400).json({ error: "That password is too long." });
  }
  const matches = await bcrypt.compare(
    current,
    req.user.passwordHash ?? DUMMY_HASH,
  );
  if (!matches) {
    return res.status(400).json({ error: "Your current password is wrong." });
  }

  const passwordHash = await bcrypt.hash(next, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, req.user.id));
  // Any other place you were signed in is signed out
  await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, req.user.id),
        ne(sessions.tokenHash, req.sessionHash),
      ),
    );
  res.json({ ok: true });
});
