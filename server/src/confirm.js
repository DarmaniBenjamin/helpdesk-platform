// Confirming important actions with a code sent by email.
//
// Before something hard to undo goes through (removing someone, changing
// someone's access, restoring a backup, connecting or removing an
// integration...), the server asks for a 6-digit code emailed to the
// person doing it. So someone who gets into an account, or a click in
// the wrong place, can't do real damage by themselves.
//
// How it works:
//   1. The action is tried as normal. If it's on the IMPORTANT list below,
//      the server answers 428 { confirm: true, action, method }.
//   2. The page (ConfirmGate.jsx) asks for the code: "email" = it calls
//      POST /api/confirm/send and the code arrives by email; "password" =
//      when no company mailbox can send yet (e.g. a brand-new site being
//      restored from a backup), the person's password is asked instead.
//   3. The action is sent again with the code (X-Confirm-Code header).
//      A right code lets it through, and any other important action for
//      the next 10 minutes, without asking again.
// Codes last 10 minutes and allow 5 tries. Only scrambled copies are kept.
//
//   POST /api/confirm/send   { action } emails a new code → { sentTo }
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { requireAuth } from "./auth.js";
import { BadInput } from "./validate.js";
import { sendSystemEmail, companyMailboxReady } from "./email.js";

const APP_NAME = "Uplink";

const MINUTE = 60 * 1000;
const CODE_LIFE = 10 * MINUTE;
const GRACE = 10 * MINUTE;

const has = (req, key) =>
  req.body && typeof req.body === "object" && key in req.body;

// The important actions: method, address (after /api), and when only
// some requests to it count. "what" is how the email describes it.
const IMPORTANT = [
  // The team
  { m: "DELETE", p: /^\/team\/[^/]+$/, what: "remove someone from the team" },
  {
    m: "PATCH",
    p: /^\/team\/[^/]+$/,
    when: (req) => has(req, "role") || has(req, "maintenance"),
    what: "change someone's access",
  },
  {
    m: "POST",
    p: /^\/team\/invite$/,
    when: (req) => req.body?.role === "admin" || Boolean(req.body?.maintenance),
    what: "invite an Admin",
  },
  // Customers (deleting one deletes all their tickets)
  { m: "DELETE", p: /^\/customers\/[^/]+$/, what: "delete a customer" },
  // Backups
  { m: "POST", p: /^\/backup\/restore$/, what: "restore a backup" },
  { m: "POST", p: /^\/backup\/offsite\/restore$/, what: "restore a backup" },
  {
    m: ["PUT", "DELETE"],
    p: /^\/backup\/offsite$/,
    what: "change the copies in the cloud",
  },
  // Integrations (the company's; agents' own mailboxes and numbers aren't)
  {
    m: ["PUT", "POST"],
    p: /^\/email\/(apps\/[^/]+|oauth\/start|default|mailboxes)$/,
    what: "change the email integration",
  },
  {
    m: "PATCH",
    p: /^\/email\/mailboxes\/[^/]+$/,
    when: (req) => has(req, "password"),
    what: "change a mailbox's password",
  },
  {
    m: "DELETE",
    p: /^\/email\/mailboxes\/[^/]+$/,
    what: "remove a mailbox",
  },
  {
    m: ["PUT", "POST", "DELETE"],
    p: /^\/whatsapp\/(app|numbers\/signup|numbers\/manual|numbers\/[^/]+)$/,
    when: (req) => req.method !== "PATCH",
    what: "change the WhatsApp integration",
  },
  {
    m: ["PUT", "POST"],
    p: /^\/phone(\/token)?$/,
    what: "change the phone integration",
  },
  {
    m: "POST",
    p: /^\/integrations\/backup(\/secret)?$/,
    what: "change the backup gateway connection",
  },
  // Maintenance → AI & GitHub, and Domain & SSL
  {
    m: ["PUT", "POST", "DELETE"],
    p: /^\/maintenance\/settings(?!\/github\/test$)(\/.*)?$/,
    what: "change the AI & GitHub settings",
  },
  {
    m: ["POST", "DELETE"],
    p: /^\/domains(\/[^/]+)?$/,
    what: "change the domains",
  },
];

function importantAction(req) {
  const p = req.path; // (mounted at /api)
  for (const rule of IMPORTANT) {
    const methods = Array.isArray(rule.m) ? rule.m : [rule.m];
    if (!methods.includes(req.method) || !rule.p.test(p)) continue;
    // Checking a domain's DNS isn't a change
    if (/^\/domains\/[^/]+\/check$/.test(p)) continue;
    if (rule.when && !rule.when(req)) continue;
    return rule.what;
  }
  return null;
}

// ---------- Codes and grace periods ----------

const codes = new Map(); // userId -> { hash, until, tries }
const confirmedUntil = new Map(); // session hash -> time

const hashCode = (code) =>
  crypto.createHash("sha256").update(String(code)).digest("hex");

function tidy() {
  const now = Date.now();
  for (const [k, v] of codes) if (v.until < now) codes.delete(k);
  for (const [k, v] of confirmedUntil) if (v < now) confirmedUntil.delete(k);
}

// Wrong codes or passwords, per person: after 5, nothing is accepted for
// 15 minutes (so they can't be guessed)
const failures = new Map(); // userId -> { count, since }
function blocked(userId) {
  const f = failures.get(userId);
  if (!f) return false;
  if (Date.now() - f.since > 15 * MINUTE) {
    failures.delete(userId);
    return false;
  }
  return f.count >= 5;
}
function failed(userId) {
  const f = failures.get(userId) ?? { count: 0, since: Date.now() };
  f.count += 1;
  failures.set(userId, f);
}

// Is the code (or password) right? Uses up the code if so.
async function checkConfirmation(req) {
  if (blocked(req.user.id)) return false;
  const ok = await checkCodeOrPassword(req);
  if (ok) failures.delete(req.user.id);
  else failed(req.user.id);
  return ok;
}

async function checkCodeOrPassword(req) {
  const typed = String(req.get("x-confirm-code") ?? "").trim();
  let password;
  try {
    password = decodeURIComponent(String(req.get("x-confirm-password") ?? ""));
  } catch {
    return false;
  }
  if (password) {
    // Only when email can't be used (method "password")
    if (await companyMailboxReady()) return false;
    return bcrypt.compare(password, req.user.passwordHash ?? "");
  }
  if (!/^\d{6}$/.test(typed)) return false;
  const entry = codes.get(req.user.id);
  if (!entry || entry.until < Date.now()) return false;
  entry.tries += 1;
  if (entry.tries > 5) {
    codes.delete(req.user.id);
    return false;
  }
  const a = Buffer.from(entry.hash);
  const b = Buffer.from(hashCode(typed));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  codes.delete(req.user.id);
  return true;
}

// Runs on every /api request (index.js, after sign-in is worked out)
export async function requireConfirmation(req, res, next) {
  if (!req.user || req.method === "GET") return next();
  const what = importantAction(req);
  if (!what) return next();
  tidy();
  if ((confirmedUntil.get(req.sessionHash) ?? 0) > Date.now()) return next();

  const sentSomething =
    req.get("x-confirm-code") !== undefined ||
    req.get("x-confirm-password") !== undefined;
  if (sentSomething) {
    if (await checkConfirmation(req)) {
      confirmedUntil.set(req.sessionHash, Date.now() + GRACE);
      return next();
    }
    const method = (await companyMailboxReady()) ? "email" : "password";
    return res.status(428).json({
      confirm: true,
      action: what,
      method,
      error: blocked(req.user.id)
        ? "Too many wrong tries. Wait 15 minutes and try again."
        : method === "email"
          ? "That code isn't right, or it has run out. Send a new one."
          : "That password isn't right.",
    });
  }
  res.status(428).json({
    confirm: true,
    action: what,
    method: (await companyMailboxReady()) ? "email" : "password",
  });
}

// ---------- The route ----------

export const confirmRouter = Router();

// A new code by email
confirmRouter.post("/send", requireAuth, async (req, res) => {
  tidy();
  const last = codes.get(req.user.id);
  if (last && last.until - CODE_LIFE > Date.now() - 30 * 1000)
    throw new BadInput("A code was just sent. Wait a few seconds.", 429);
  const action = String(req.body?.action ?? "an important change").slice(
    0,
    100,
  );
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  codes.set(req.user.id, {
    hash: hashCode(code),
    until: Date.now() + CODE_LIFE,
    tries: 0,
  });
  const result = await sendSystemEmail({
    to: req.user.email,
    subject: `${code} is your ${APP_NAME} confirmation code`,
    text: [
      `Hi ${req.user.name || "there"},`,
      "",
      `Someone signed in as you wants to ${action}. To allow it, type this code in the helpdesk:`,
      "",
      `    ${code}`,
      "",
      "It works for 10 minutes. If this wasn't you, don't share the code, and change your password.",
    ].join("\n"),
  });
  if (!result.sent) {
    codes.delete(req.user.id);
    throw new BadInput(`The code couldn't be emailed: ${result.why}`, 503);
  }
  const [name, domain] = req.user.email.split("@");
  res.json({
    sentTo: `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`,
  });
});
