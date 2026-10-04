// Email: Integrations → Email. Customers' emails become tickets, and
// agents' replies on those tickets go back to them by email.
//
// Mailboxes are connected from the web page, three ways:
//   - "Sign in with Microsoft" (Microsoft 365, Outlook.com)
//   - "Sign in with Google" (Gmail, Google Workspace)
//   - "Other": an email address and password (an app password for
//     Gmail), for any provider with IMAP and SMTP
// The Microsoft and Google buttons need a sign-in "app" registered once
// with Microsoft/Google; its Client ID and secret are pasted into the
// same page (stored in the settings table, the secret locked with
// secrets.js). Nothing to put in server/.env.
//
// Reading: every minute, each mailbox's Inbox is checked for emails that
// arrived since the last check (IMAP). The first check only notes where
// the Inbox is up to, so old emails never flood in as tickets. Nothing in
// the mailbox is changed: emails stay unread for whoever else uses it.
// Each new email:
//   - a reply to an email on a ticket (its In-Reply-To/References point
//     at one), or with [#123] in the subject from that ticket's customer:
//     added to that ticket, which reopens if it was waiting/resolved
//     (a closed ticket gets a new one instead, like the portal)
//   - otherwise: a new ticket (source "email") for the customer with that
//     address (made if new), given to the mailbox's agent and/or team
//   - attachments come too (photos, documents, voicemail audio...)
//   - skipped: automatic replies ("Out of office"), mailing lists, and
//     emails from the helpdesk's own mailboxes (so they can't loop)
//
// Sending: every few seconds, new replies to the customer are emailed
// (done from here, by looking for new replies, so tickets.js doesn't need
// to know). Internal notes are never emailed, and nor are replies the
// agent sent on WhatsApp instead.
//   - A ticket that came in by email: replies go back from the same
//     mailbox, in the same email thread, with the ticket number in the
//     subject: "Re: Printer won't print [#123]". Automatic replies too.
//   - Any other ticket: only replies the agent chose to send by email,
//     to the customer's email address, from the agent's own mailbox (the
//     one whose new tickets go to them) or else the company's mailbox
//     (picked in Integrations → Email). The customer's reply to that
//     email lands back on the ticket.
//
//   GET    /api/email                       apps, mailboxes, agents
//   PUT    /api/email/apps/:provider        save a sign-in app
//   POST   /api/email/oauth/start           { provider, origin } → { url }
//   GET    /api/email/oauth/callback        where Microsoft/Google return
//   POST   /api/email/mailboxes             add an "Other" mailbox
//   PATCH  /api/email/mailboxes/:id         name, agent, team, on/off, password
//   PUT    /api/email/default               { mailboxId } the company mailbox
//   DELETE /api/email/mailboxes/:id
//   POST   /api/email/mailboxes/:id/check   check for new emails now
//   POST   /api/email/mailboxes/:id/test    send yourself a test email
// All for Admins and the Super Admin (the "integrations" permission).
import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { db } from "./db/index.js";
import {
  attachments,
  customers,
  departments,
  emailMessages,
  mailboxes,
  messages,
  settings,
  tickets,
  users,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { BadInput } from "./validate.js";
import { seal, unseal, LockedSecret } from "./secrets.js";
import { UPLOAD_DIR, MAX_FILE_SIZE } from "./attachments.js";
import { getSla } from "./sla.js";
import { recordEvent } from "./activity.js";
import { afterTicketEvent } from "./automation.js";
import {
  onCustomerReply,
  onTicketAssigned,
  onTicketCreated,
} from "./notify.js";
import { sendToEveryone } from "./live.js";

export const emailRouter = Router();

const HOUR = 60 * 60 * 1000;
const CHECK_EVERY = 60 * 1000;
const MAX_BODY = 20000;

// ============================================================
// Microsoft and Google sign-in
// ============================================================

const PROVIDERS = {
  microsoft: {
    label: "Microsoft",
    authorize: (tenant) =>
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token: (tenant) =>
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope:
      "offline_access openid email https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    extra: { prompt: "select_account", response_mode: "query" },
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp.office365.com", port: 587 },
  },
  google: {
    label: "Google",
    authorize: () => "https://accounts.google.com/o/oauth2/v2/auth",
    token: () => "https://oauth2.googleapis.com/token",
    scope: "openid email https://mail.google.com/",
    extra: { access_type: "offline", prompt: "consent" },
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465 },
  },
};

// The sign-in apps' details, from the settings table:
// { microsoft: { clientId, secret, tenant }, google: { clientId, secret } }
async function loadApps() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "emailApps"));
  return row?.value ?? {};
}

async function saveApps(value) {
  await db
    .insert(settings)
    .values({ key: "emailApps", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function appFor(provider) {
  const app = (await loadApps())[provider];
  if (!app?.clientId || !app?.secret)
    throw new BadInput(
      `Set up the ${PROVIDERS[provider].label} sign-in first (Client ID and secret).`,
    );
  return {
    clientId: app.clientId,
    clientSecret: unseal(app.secret),
    tenant: app.tenant || "common",
  };
}

// Asks Microsoft/Google for tokens (with a sign-in code, or to refresh)
async function tokenRequest(provider, params) {
  const app = await appFor(provider);
  const res = await fetch(PROVIDERS[provider].token(app.tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...params,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const why = data.error_description || data.error || `error ${res.status}`;
    throw new BadInput(
      `${PROVIDERS[provider].label} didn't accept the sign-in: ${String(why).split("\n")[0]}`,
    );
  }
  return data;
}

// The email address in the sign-in's ID token. It comes straight from
// Microsoft/Google over https, so it's only read here, not checked.
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
    );
    return String(payload.email || payload.preferred_username || "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

// Access tokens last about an hour; they're kept here until then
const accessTokens = new Map(); // mailbox id -> { token, until }

async function accessTokenFor(box) {
  const cached = accessTokens.get(box.id);
  if (cached && cached.until > Date.now() + 60 * 1000) return cached.token;
  const data = await tokenRequest(box.provider, {
    grant_type: "refresh_token",
    refresh_token: unseal(box.secret),
    ...(box.provider === "microsoft"
      ? { scope: PROVIDERS.microsoft.scope }
      : {}),
  });
  accessTokens.set(box.id, {
    token: data.access_token,
    until: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  // Microsoft hands out a new refresh token each time: keep the newest
  if (data.refresh_token)
    await db
      .update(mailboxes)
      .set({ secret: seal(data.refresh_token) })
      .where(eq(mailboxes.id, box.id));
  return data.access_token;
}

// Sign-ins in progress: the random "state" sent to Microsoft/Google comes
// back with the code, proving it's the same person who started it
const pending = new Map(); // state -> { provider, redirectUri, origin, userId, until }
setInterval(
  () => {
    for (const [state, p] of pending)
      if (p.until < Date.now()) pending.delete(state);
  },
  10 * 60 * 1000,
).unref();

// ============================================================
// Connecting to a mailbox
// ============================================================

// How to log in to a mailbox: a password, or a fresh access token
async function authFor(box) {
  if (box.provider === "imap")
    return { user: box.username, pass: unseal(box.secret) };
  return { user: box.username, accessToken: await accessTokenFor(box) };
}

function imapClient(box, auth) {
  return new ImapFlow({
    host: box.imapHost,
    port: box.imapPort,
    secure: box.imapPort === 993,
    auth,
    logger: false,
    connectionTimeout: 20 * 1000,
    greetingTimeout: 15 * 1000,
    socketTimeout: 60 * 1000,
  });
}

function smtpTransport(box, auth) {
  return nodemailer.createTransport({
    host: box.smtpHost,
    port: box.smtpPort,
    secure: box.smtpPort === 465,
    requireTLS: box.smtpPort !== 465,
    auth: auth.accessToken
      ? { type: "OAuth2", user: auth.user, accessToken: auth.accessToken }
      : { user: auth.user, pass: auth.pass },
    connectionTimeout: 20 * 1000,
  });
}

// Plain words for what went wrong
function explain(err, box) {
  if (err instanceof LockedSecret || err instanceof BadInput)
    return err.message;
  const text = `${err.responseText || err.response || err.message || err}`;
  if (
    err.authenticationFailed ||
    /auth|credentials|password|login/i.test(text)
  ) {
    if (box?.provider === "imap")
      return "The email or password was wrong. For Gmail and other accounts with 2-step verification, use an app password.";
    return "The sign-in didn't work anymore. Sign in again.";
  }
  if (/SmtpClientAuthentication is disabled|5\.7\.139|5\.7\.3/i.test(text))
    return "Sending is turned off for this mailbox. In the Microsoft 365 admin center, turn on Authenticated SMTP for it (Mail → Manage email apps).";
  if (err.code === "ENOTFOUND")
    return `Couldn't find the server ${err.hostname ?? ""}.`.trim();
  if (
    [
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ESOCKET",
      "ECONNECTION",
      "CONNECT_TIMEOUT",
      "GREETING_TIMEOUT",
    ].includes(err.code) ||
    /establish connection|timed? ?out/i.test(text)
  )
    return "Couldn't reach the mail server. Check the server name and port.";
  return text.split("\n")[0].slice(0, 300);
}

// Logs in by IMAP (and SMTP) to check a mailbox works, before saving it
async function tryMailbox(box, auth) {
  const client = imapClient(box, auth);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
  } catch (err) {
    throw new BadInput(`Reading mail didn't work: ${explain(err, box)}`);
  } finally {
    await client.logout().catch(() => {});
  }
  try {
    await smtpTransport(box, auth).verify();
  } catch (err) {
    throw new BadInput(`Sending mail didn't work: ${explain(err, box)}`);
  }
}

// ============================================================
// Reading new emails
// ============================================================

let checking = false;

// Checks every switched-on mailbox (every minute, see startEmailChecks)
async function checkAll() {
  if (checking) return;
  checking = true;
  try {
    const boxes = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.enabled, true))
      .orderBy(asc(mailboxes.id));
    for (const box of boxes) await checkMailbox(box);
  } finally {
    checking = false;
  }
}

// Checks are done one at a time, in order, even when "Check now" is
// clicked while the every-minute check is running, so the same email is
// never read twice at once
let queue = Promise.resolve();
function checkMailbox(box) {
  const run = queue.then(() => checkMailboxNow(box.id));
  queue = run.catch(() => {});
  return run;
}

// Checks one mailbox. Never throws: problems go in lastError, which the
// page shows.
async function checkMailboxNow(id) {
  // Fresh from the database: an earlier check may have moved lastUid on
  const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, id));
  if (!box) return;
  let client;
  try {
    client = imapClient(box, await authFor(box));
    await client.connect();
    const inbox = await client.mailboxOpen("INBOX", { readOnly: true });
    const validity = String(inbox.uidValidity);
    const newest = Number(inbox.uidNext) - 1;

    // First check (or the Inbox was rebuilt): start from now
    if (box.uidValidity !== validity) {
      await db
        .update(mailboxes)
        .set({
          uidValidity: validity,
          lastUid: newest,
          lastCheckedAt: new Date(),
          lastError: null,
        })
        .where(eq(mailboxes.id, box.id));
      return;
    }

    let lastUid = box.lastUid;
    if (newest > lastUid) {
      const found = [];
      for await (const msg of client.fetch(
        `${lastUid + 1}:*`,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (msg.uid > lastUid) found.push({ uid: msg.uid, source: msg.source });
      }
      found.sort((a, b) => a.uid - b.uid);
      for (const { uid, source } of found) {
        try {
          await receiveEmail(box, source);
        } catch (err) {
          console.error(`Email ${box.address} #${uid}:`, err);
        }
        lastUid = uid;
        await db
          .update(mailboxes)
          .set({ lastUid })
          .where(eq(mailboxes.id, box.id));
      }
    }
    await db
      .update(mailboxes)
      .set({ lastCheckedAt: new Date(), lastError: null })
      .where(eq(mailboxes.id, box.id));
  } catch (err) {
    await db
      .update(mailboxes)
      .set({ lastCheckedAt: new Date(), lastError: explain(err, box) })
      .where(eq(mailboxes.id, box.id));
  } finally {
    await client?.logout().catch(() => {});
  }
}

// Automatic emails that shouldn't become tickets
function isAutomatic(parsed) {
  const h = parsed.headers;
  const autoSubmitted = String(h.get("auto-submitted") ?? "").toLowerCase();
  const precedence = String(h.get("precedence") ?? "").toLowerCase();
  return (
    autoSubmitted === "auto-replied" ||
    ["bulk", "list", "junk", "auto_reply"].includes(precedence) ||
    h.has("x-autoreply") ||
    h.has("x-autorespond") ||
    h.has("list-unsubscribe") ||
    /^(auto(matic)? ?reply|out of (the )?office|automatische antwort)/i.test(
      parsed.subject ?? "",
    )
  );
}

// Only the new part of a reply: the quoted earlier email is cut off
function withoutQuote(text) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex(
    (line, i) =>
      /^On .{3,200}wrote:\s*$/.test(line) ||
      (/^On .{3,200}$/.test(line) && /wrote:\s*$/.test(lines[i + 1] ?? "")) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
      /^_{10,}\s*$/.test(line) ||
      (/^From:\s/.test(line) && /^(Sent|Date):\s/.test(lines[i + 1] ?? "")),
  );
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter(
    (line) => !line.startsWith(">"),
  );
  return kept.join("\n").trim() || text.trim();
}

const idsIn = (value) =>
  (Array.isArray(value) ? value : String(value ?? "").split(/\s+/))
    .map((v) => String(v).trim())
    .filter(Boolean);

// One email that arrived in a mailbox
async function receiveEmail(box, source) {
  const parsed = await simpleParser(source);
  const from = parsed.from?.value?.[0];
  const address = String(from?.address ?? "")
    .trim()
    .toLowerCase();
  if (!address) return;

  // Already seen (e.g. it's in two of our mailboxes)?
  const messageId =
    parsed.messageId || `<missing-${crypto.randomUUID()}@helpdesk>`;
  const [seen] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.messageId, messageId));
  if (seen) return;

  // From one of our own mailboxes, or automatic: skip
  const ours = await db
    .select({ address: mailboxes.address })
    .from(mailboxes)
    .where(eq(mailboxes.address, address));
  if (ours.length || isAutomatic(parsed)) return;

  const name = (from.name || address.split("@")[0]).trim().slice(0, 100);
  const subject = (parsed.subject || "(no subject)").trim().slice(0, 200);
  const fullText = (parsed.text || "").replace(/\u00a0/g, " ").trim();

  // ---- Which ticket it belongs to ----
  let ticket = null;
  const refs = [...idsIn(parsed.inReplyTo), ...idsIn(parsed.references)];
  if (refs.length) {
    const [row] = await db
      .select({ ticket: tickets })
      .from(emailMessages)
      .innerJoin(tickets, eq(emailMessages.ticketId, tickets.id))
      .where(inArray(emailMessages.messageId, refs))
      .orderBy(desc(emailMessages.createdAt))
      .limit(1);
    ticket = row?.ticket ?? null;
  }
  const customer = await customerFor(address, name);
  if (!ticket) {
    // [#123] in the subject, from that ticket's own customer
    const number = Number(subject.match(/\[#(\d+)\]/)?.[1]);
    if (number) {
      const [row] = await db
        .select()
        .from(tickets)
        .where(
          and(eq(tickets.id, number), eq(tickets.customerId, customer.id)),
        );
      ticket = row ?? null;
    }
  }
  if (ticket?.status === "closed") ticket = null; // like the portal: a new one

  const now = new Date();
  if (ticket) {
    await addReply(ticket, {
      box,
      customer,
      name,
      text: withoutQuote(fullText),
      parsed,
      messageId,
      address,
      now,
    });
  } else {
    await newTicket({
      box,
      customer,
      name,
      subject,
      text: fullText,
      parsed,
      messageId,
      address,
      now,
    });
  }
}

// The customer with this email (main or extra), or a new one
async function customerFor(address, name) {
  const [found] = await db
    .select()
    .from(customers)
    .where(
      or(
        eq(customers.email, address),
        sql`${address} = any(${customers.extraEmails})`,
      ),
    )
    .limit(1);
  if (found) return found;
  const [made] = await db
    .insert(customers)
    .values({ name, email: address, phone: "" })
    .returning();
  return made;
}

// The kinds of attachment kept from emails (the same as files people can
// attach in the helpdesk, plus voicemail and voice note audio)
const KEPT_FILES = new Set(
  "jpg jpeg png gif webp heic heif bmp pdf txt log csv rtf doc docx xls xlsx ppt pptx odt ods eml msg zip 7z rar gz mp4 mov webm wav mp3 m4a ogg opus aac amr".split(
    " ",
  ),
);
const endingOf = (name) => path.extname(name).slice(1).toLowerCase();

// A tidy file name: no folders, no odd characters, not too long
function cleanFileName(name) {
  const base = path
    .basename(String(name || "file"))
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "file").slice(-150);
}

// Saves one file straight onto a message, in the uploads folder like any
// other attachment. Returns false (and saves nothing) if it's a kind of
// file that isn't allowed, or too big.
async function saveFile({ fileName, content, ticketId, messageId }) {
  const name = cleanFileName(fileName);
  const ending = endingOf(name);
  if (!KEPT_FILES.has(ending) || content.length > MAX_FILE_SIZE) return false;
  const storageKey = `${crypto.randomUUID()}.${ending}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, storageKey), content);
  await db.insert(attachments).values({
    ticketId,
    messageId,
    uploadedById: null,
    fileName: name,
    size: content.length,
    storageKey,
  });
  return true;
}

// The files on a reply, ready to go with the email
async function filesToSend(messageId) {
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.messageId, messageId));
  return rows.map((a) => ({
    filename: a.fileName,
    path: path.join(UPLOAD_DIR, a.storageKey),
  }));
}

// Saves an email's attachments onto a message. Returns the names of any
// that weren't kept (a kind of file that isn't allowed, or too big).
async function saveAttachments(parsed, ticketId, messageId) {
  const skipped = [];
  for (const [i, a] of (parsed.attachments ?? []).entries()) {
    // Small pictures inside the email itself: signature logos and icons
    if (
      a.contentDisposition === "inline" &&
      a.contentType?.startsWith("image/") &&
      a.size < 15 * 1024
    )
      continue;
    const ending = (a.contentType || "").split("/")[1]?.split(/[;+]/)[0];
    const fileName = a.filename || `attachment-${i + 1}.${ending || "bin"}`;
    const saved = await saveFile({
      fileName,
      content: a.content,
      ticketId,
      messageId,
    });
    if (!saved) skipped.push(fileName);
  }
  return skipped;
}

const skippedNote = (skipped) =>
  skipped.length
    ? `\n\n(Not kept: ${skipped.join(", ")}. That kind of file can't be attached, or it was too big.)`
    : "";

// A customer's email on an existing ticket
async function addReply(
  ticket,
  { box, name, text, parsed, messageId, address, now },
) {
  const reopen = ["waiting", "resolved"].includes(ticket.status);
  const [msg] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      kind: "customer",
      authorName: name,
      body: text.slice(0, MAX_BODY) || "(empty email)",
      createdAt: now,
    })
    .returning({ id: messages.id });
  const skipped = await saveAttachments(parsed, ticket.id, msg.id);
  if (skipped.length)
    await db
      .update(messages)
      .set({ body: sql`${messages.body} || ${skippedNote(skipped)}` })
      .where(eq(messages.id, msg.id));
  await db.insert(emailMessages).values({
    messageId,
    ticketId: ticket.id,
    mailboxId: box.id,
    direction: "in",
    address,
  });
  await db
    .update(tickets)
    .set({
      updatedAt: now,
      ...(reopen ? { status: "open", resolvedAt: null, closedAt: null } : {}),
    })
    .where(eq(tickets.id, ticket.id));
  if (reopen)
    await recordEvent({
      ticket,
      actor: { id: null, name },
      type: "status:open",
      body: "reopened it by replying to the email",
      at: new Date(now.getTime() + 1),
    });
  onCustomerReply(ticket, name, text || "Sent an email");
  await afterTicketEvent(ticket.id, "customerReply");
  if (reopen) await afterTicketEvent(ticket.id, "statusChanged", "open");
  sendToEveryone("changed", {
    resource: "tickets",
    id: ticket.id,
    customerId: ticket.customerId,
  });
}

// A new email: a new ticket
async function newTicket({
  box,
  customer,
  name,
  subject,
  text,
  parsed,
  messageId,
  address,
  now,
}) {
  // The mailbox's agent, if they're still active staff
  let assigneeId = null;
  if (box.assigneeId) {
    const [agent] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, box.assigneeId), eq(users.status, "active")));
    assigneeId = agent?.id ?? null;
  }
  const sla = await getSla();
  const priority = 2; // Medium, until someone looks at it
  const [ticket] = await db
    .insert(tickets)
    .values({
      subject,
      description: text.slice(0, MAX_BODY),
      status: "open",
      priority,
      departmentId: box.departmentId,
      assigneeId,
      customerId: customer.id,
      source: "email",
      firstResponseDue: new Date(
        now.getTime() + sla[priority].firstResponse * HOUR,
      ),
      dueBy: new Date(now.getTime() + sla[priority].resolve * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [msg] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      kind: "customer",
      authorName: name,
      body: text.slice(0, MAX_BODY) || "(empty email)",
      createdAt: now,
    })
    .returning({ id: messages.id });
  const skipped = await saveAttachments(parsed, ticket.id, msg.id);
  if (skipped.length)
    await db
      .update(messages)
      .set({ body: sql`${messages.body} || ${skippedNote(skipped)}` })
      .where(eq(messages.id, msg.id));
  await db.insert(emailMessages).values({
    messageId,
    ticketId: ticket.id,
    mailboxId: box.id,
    direction: "in",
    address,
  });
  await recordEvent({
    ticket,
    actor: { id: null, name },
    type: "created",
    body: `emailed ${box.address}`,
    at: new Date(now.getTime() + 1),
  });
  await afterTicketEvent(ticket.id, "created");
  onTicketCreated(ticket, name, { id: null });
  if (assigneeId)
    onTicketAssigned(ticket, assigneeId, { id: null, name: box.address });
  sendToEveryone("changed", {
    resource: "tickets",
    id: ticket.id,
    customerId: customer.id,
  });
}

// ============================================================
// Sending replies
// ============================================================

// The company mailbox (Integrations → Email: "Send other emails from")
async function defaultMailboxId() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "emailDefault"));
  return row?.value?.mailboxId ?? null;
}

// Which mailbox an agent's email goes out from: their own (the switched-
// on mailbox whose new tickets go to them), or else the company mailbox
async function senderFor(userId) {
  if (userId) {
    const [own] = await db
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.assigneeId, userId), eq(mailboxes.enabled, true)))
      .orderBy(asc(mailboxes.id))
      .limit(1);
    if (own) return own;
  }
  const id = await defaultMailboxId();
  if (!id) return null;
  const [box] = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, id), eq(mailboxes.enabled, true)));
  return box ?? null;
}

// Can this person email a customer from the helpdesk? (The ticket page
// asks, to offer "Reply by email" on tickets that didn't come by email.)
export async function canSendEmail(user) {
  return Boolean(await senderFor(user.id));
}

// Emails a reply (or automatic reply) on a ticket to the customer, if
// the ticket came in by email (see sendNewReplies below). Never throws:
// a problem shows in the bell of the people on the ticket instead.
async function emailReply(ticketId, messageId) {
  try {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId));
    const [msg] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId));
    if (!ticket || !msg) return;
    // Sent on WhatsApp instead: nothing to email
    if (msg.channel === "whatsapp") return;

    // The customer's latest email on this ticket, if it came by email
    const [last] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.ticketId, ticketId),
          eq(emailMessages.direction, "in"),
        ),
      )
      .orderBy(desc(emailMessages.createdAt))
      .limit(1);
    if (!last) {
      // Not an email ticket: only if the agent chose "by email"
      if (msg.channel === "email") await emailFresh(ticket, msg);
      return;
    }

    const fail = (why) =>
      recordEvent({
        ticket,
        actor: { id: null, name: "Email" },
        type: "emailFailed",
        body: `couldn't send this reply by email: ${why}`,
      });

    const [box] = last.mailboxId
      ? await db
          .select()
          .from(mailboxes)
          .where(eq(mailboxes.id, last.mailboxId))
      : [];
    if (!box) return fail("the mailbox it came in on was removed.");

    // The thread so far, so it shows as one conversation in their inbox
    const thread = (
      await db
        .select({ id: emailMessages.messageId })
        .from(emailMessages)
        .where(eq(emailMessages.ticketId, ticketId))
        .orderBy(asc(emailMessages.createdAt))
    ).map((r) => r.id);

    const domain = box.address.split("@")[1] || "helpdesk";
    const newId = `<ticket-${ticketId}-${messageId}-${crypto.randomBytes(4).toString("hex")}@${domain}>`;
    const subject = `Re: ${ticket.subject.replace(/^(re|fw|fwd):\s*/i, "").replace(/\s*\[#\d+\]\s*$/, "")} [#${ticket.id}]`;

    try {
      const auth = await authFor(box);
      await smtpTransport(box, auth).sendMail({
        // An agent's reply: their name. An automatic reply: the mailbox's
        // name (Integrations → Email), e.g. "Uplink Support"
        from: {
          name: msg.authorId
            ? msg.authorName
            : box.name || msg.authorName || box.address,
          address: box.address,
        },
        to: last.address,
        subject,
        text: msg.body,
        messageId: newId,
        inReplyTo: last.messageId,
        references: thread.slice(-10),
        attachments: await filesToSend(messageId),
      });
    } catch (err) {
      return fail(explain(err, box));
    }
    await db.insert(emailMessages).values({
      messageId: newId,
      ticketId,
      mailboxId: box.id,
      direction: "out",
      address: last.address,
    });
  } catch (err) {
    console.error(`Emailing reply on #${ticketId}:`, err);
  }
}

// A reply by email on a ticket that didn't come by email: a new email to
// the customer's address, from the agent's mailbox or the company's.
// Their reply to it comes back to this ticket (its Message-ID is kept).
async function emailFresh(ticket, msg) {
  const fail = (why) =>
    recordEvent({
      ticket,
      actor: { id: null, name: "Email" },
      type: "emailFailed",
      body: `couldn't send this reply by email: ${why}`,
    });
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, ticket.customerId));
  const to = customer?.email;
  if (!to) return fail("the customer has no email address.");
  const box = await senderFor(msg.authorId);
  if (!box)
    return fail(
      "there's no mailbox to send from. Connect one in Integrations → Email.",
    );

  const domain = box.address.split("@")[1] || "helpdesk";
  const newId = `<ticket-${ticket.id}-${msg.id}-${crypto.randomBytes(4).toString("hex")}@${domain}>`;
  // Earlier emails we sent on this ticket, so it stays one conversation
  const thread = (
    await db
      .select({ id: emailMessages.messageId })
      .from(emailMessages)
      .where(eq(emailMessages.ticketId, ticket.id))
      .orderBy(asc(emailMessages.createdAt))
  ).map((r) => r.id);
  const subject = `${thread.length ? "Re: " : ""}${ticket.subject.replace(/\s*\[#\d+\]\s*$/, "")} [#${ticket.id}]`;
  try {
    const auth = await authFor(box);
    await smtpTransport(box, auth).sendMail({
      from: {
        name: msg.authorId ? msg.authorName : box.name || box.address,
        address: box.address,
      },
      to,
      subject,
      text: msg.body,
      messageId: newId,
      ...(thread.length
        ? { inReplyTo: thread.at(-1), references: thread.slice(-10) }
        : {}),
      attachments: await filesToSend(msg.id),
    });
  } catch (err) {
    return fail(explain(err, box));
  }
  await db.insert(emailMessages).values({
    messageId: newId,
    ticketId: ticket.id,
    mailboxId: box.id,
    direction: "out",
    address: to,
  });
}

// New replies to email: looks for agents' (and automations') replies
// saved since last time, on tickets that came in by email, and emails
// them. Where it got to is kept in the settings table, so a restart
// carries on from there; the very first time, it starts from now.
let sending = false;
async function sendNewReplies() {
  if (sending) return;
  sending = true;
  try {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "emailOutbox"));
    let after = row?.value?.lastMessageId;
    if (after === undefined) {
      const [{ max }] = await db
        .select({ max: sql`coalesce(max(${messages.id}), 0)`.mapWith(Number) })
        .from(messages);
      after = max;
    }
    const replies = await db
      .select({ id: messages.id, ticketId: messages.ticketId })
      .from(messages)
      .where(
        and(
          eq(messages.kind, "agent"),
          sql`${messages.id} > ${after}`,
          // Chosen "by email", or on a ticket that came by email (and not
          // sent on WhatsApp instead)
          sql`(${messages.channel} = 'email' or (${messages.channel} is null and exists (select 1 from ${emailMessages} where ${emailMessages.ticketId} = ${messages.ticketId} and ${emailMessages.direction} = 'in')))`,
        ),
      )
      .orderBy(asc(messages.id))
      .limit(50);
    // Nothing new to email: still move on past any other new messages
    const [{ newest }] = await db
      .select({ newest: sql`coalesce(max(${messages.id}), 0)`.mapWith(Number) })
      .from(messages);
    for (const reply of replies) {
      await emailReply(reply.ticketId, reply.id);
      after = reply.id;
    }
    if (replies.length < 50) after = Math.max(after, newest);
    await db
      .insert(settings)
      .values({ key: "emailOutbox", value: { lastMessageId: after } })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: { lastMessageId: after } },
      });
  } finally {
    sending = false;
  }
}

// ============================================================
// The routes
// ============================================================

// Microsoft/Google send the browser back here after signing in. It's
// before the Admin check below so problems come back as a message on the
// page; it only works for the same signed-in person who started it.
emailRouter.get("/oauth/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  const started = pending.get(state);
  pending.delete(state);
  const back = (params) =>
    res.redirect(
      `${started?.origin ?? ""}/integrations?${new URLSearchParams(params)}`,
    );
  if (!started || started.until < Date.now() || started.userId !== req.user?.id)
    return back({
      emailError: "That sign-in took too long or was already used. Try again.",
    });
  if (req.query.error)
    return back({
      emailError: `${PROVIDERS[started.provider].label} said: ${String(
        req.query.error_description || req.query.error,
      )
        .split("\n")[0]
        .slice(0, 300)}`,
    });

  try {
    const { provider } = started;
    const data = await tokenRequest(provider, {
      grant_type: "authorization_code",
      code: String(req.query.code ?? ""),
      redirect_uri: started.redirectUri,
      ...(provider === "microsoft" ? { scope: PROVIDERS.microsoft.scope } : {}),
    });
    if (!data.refresh_token)
      throw new BadInput(
        `${PROVIDERS[provider].label} didn't allow staying signed in. Try again.`,
      );
    const address = emailFromIdToken(data.id_token ?? "");
    if (!address)
      throw new BadInput("Couldn't tell which email address signed in.");

    const box = {
      provider,
      address,
      username: address,
      imapHost: PROVIDERS[provider].imap.host,
      imapPort: PROVIDERS[provider].imap.port,
      smtpHost: PROVIDERS[provider].smtp.host,
      smtpPort: PROVIDERS[provider].smtp.port,
    };
    await tryMailbox(box, { user: address, accessToken: data.access_token });

    // A mailbox that's already here (signing in again) keeps its settings
    const [existing] = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.address, address));
    let saved;
    if (existing) {
      [saved] = await db
        .update(mailboxes)
        .set({
          ...box,
          secret: seal(data.refresh_token),
          lastError: null,
          enabled: true,
        })
        .where(eq(mailboxes.id, existing.id))
        .returning();
    } else {
      [saved] = await db
        .insert(mailboxes)
        .values({ ...box, secret: seal(data.refresh_token) })
        .returning();
    }
    accessTokens.set(saved.id, {
      token: data.access_token,
      until: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    checkMailbox(saved).catch(() => {});
    back({ emailConnected: address });
  } catch (err) {
    back({ emailError: explain(err) });
  }
});

emailRouter.use(requireRole("owner", "admin"));

function publicMailbox(b) {
  return {
    id: b.id,
    address: b.address,
    name: b.name,
    provider: b.provider,
    imapHost: b.imapHost,
    imapPort: b.imapPort,
    smtpHost: b.smtpHost,
    smtpPort: b.smtpPort,
    username: b.username,
    assigneeId: b.assigneeId,
    departmentId: b.departmentId,
    enabled: b.enabled,
    lastCheckedAt: b.lastCheckedAt ? b.lastCheckedAt.getTime() : null,
    lastError: b.lastError,
  };
}

async function overview() {
  const apps = await loadApps();
  const boxes = await db.select().from(mailboxes).orderBy(asc(mailboxes.id));
  const agents = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        inArray(users.role, ["owner", "admin", "agent"]),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(users.name));
  const teams = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .orderBy(asc(departments.name));
  return {
    apps: {
      microsoft: {
        clientId: apps.microsoft?.clientId ?? "",
        tenant: apps.microsoft?.tenant ?? "common",
        ready: Boolean(apps.microsoft?.clientId && apps.microsoft?.secret),
      },
      google: {
        clientId: apps.google?.clientId ?? "",
        ready: Boolean(apps.google?.clientId && apps.google?.secret),
      },
    },
    mailboxes: boxes.map(publicMailbox),
    defaultMailboxId: await defaultMailboxId(),
    agents,
    teams,
  };
}

async function findMailbox(id) {
  const [box] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, Number(id) || 0));
  if (!box) throw new BadInput("That mailbox isn't connected anymore.", 404);
  return box;
}

const cleanHost = (value, label) => {
  const host = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9.-]{3,253}$/.test(host))
    throw new BadInput(
      `Enter the ${label} server's name, e.g. mail.example.com.`,
    );
  return host;
};
const cleanPort = (value, label) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new BadInput(`The ${label} port isn't valid.`);
  return port;
};
const cleanAddress = (value) => {
  const address = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254)
    throw new BadInput("Enter a valid email address.");
  return address;
};

emailRouter.get("/", async (req, res) => {
  res.json(await overview());
});

// Save (or clear) the Microsoft or Google sign-in app
emailRouter.put("/apps/:provider", async (req, res) => {
  const provider = req.params.provider;
  if (!PROVIDERS[provider]) throw new BadInput("Unknown sign-in.", 404);
  const apps = await loadApps();
  const clientId = String(req.body?.clientId ?? "").trim();
  const clientSecret = String(req.body?.clientSecret ?? "").trim();
  if (!clientId) {
    delete apps[provider];
  } else {
    if (clientId.length > 200)
      throw new BadInput("That Client ID is too long.");
    const before = apps[provider] ?? {};
    // The secret is never sent back to the page, so an empty one = keep
    if (!clientSecret && !before.secret)
      throw new BadInput("Paste the Client secret too.");
    apps[provider] = {
      clientId,
      secret: clientSecret ? seal(clientSecret) : before.secret,
      ...(provider === "microsoft"
        ? { tenant: String(req.body?.tenant ?? "").trim() || "common" }
        : {}),
    };
    if (
      provider === "microsoft" &&
      !/^[a-z0-9.-]{3,100}$/i.test(apps[provider].tenant)
    )
      throw new BadInput(
        "The tenant should be common, organizations, or your tenant ID/domain.",
      );
  }
  await saveApps(apps);
  res.json(await overview());
});

// Start signing in to a Microsoft/Google mailbox: the page sends the
// browser to the URL this returns
emailRouter.post("/oauth/start", async (req, res) => {
  const provider = String(req.body?.provider ?? "");
  if (!PROVIDERS[provider]) throw new BadInput("Unknown sign-in.");
  let origin;
  try {
    origin = new URL(String(req.body?.origin ?? ""));
  } catch {
    throw new BadInput("The page's address is missing.");
  }
  // Only this site's own address (not some other site)
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.hostname !== req.hostname
  )
    throw new BadInput(
      "Open this page on the helpdesk's own address and try again.",
    );
  const app = await appFor(provider);
  const state = crypto.randomBytes(24).toString("base64url");
  const redirectUri = `${origin.origin}/api/email/oauth/callback`;
  pending.set(state, {
    provider,
    redirectUri,
    origin: origin.origin,
    userId: req.user.id,
    until: Date.now() + 15 * 60 * 1000,
  });
  const url = new URL(PROVIDERS[provider].authorize(app.tenant));
  url.search = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: PROVIDERS[provider].scope,
    state,
    ...PROVIDERS[provider].extra,
  });
  res.json({ url: url.toString() });
});

// The company mailbox: emails that aren't from a particular agent's own
// mailbox go out from it (replies by email, and later invites etc.)
emailRouter.put("/default", async (req, res) => {
  const id = req.body?.mailboxId ? Number(req.body.mailboxId) : null;
  if (id) await findMailbox(id);
  const value = { mailboxId: id };
  await db
    .insert(settings)
    .values({ key: "emailDefault", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  res.json(await overview());
});

// Add an "Other" mailbox: email address and password
emailRouter.post("/mailboxes", async (req, res) => {
  const b = req.body ?? {};
  const address = cleanAddress(b.address);
  const password = String(b.password ?? "");
  if (!password)
    throw new BadInput("Enter the mailbox's password (or app password).");
  const box = {
    provider: "imap",
    address,
    name: String(b.name ?? "")
      .trim()
      .slice(0, 100),
    username: String(b.username ?? "").trim() || address,
    imapHost: cleanHost(b.imapHost, "incoming (IMAP)"),
    imapPort: cleanPort(b.imapPort, "IMAP"),
    smtpHost: cleanHost(b.smtpHost, "outgoing (SMTP)"),
    smtpPort: cleanPort(b.smtpPort, "SMTP"),
  };
  const [taken] = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.address, address));
  if (taken) throw new BadInput("That mailbox is already connected.");
  await tryMailbox(box, { user: box.username, pass: password });
  const [saved] = await db
    .insert(mailboxes)
    .values({ ...box, secret: seal(password) })
    .returning();
  await checkMailbox(saved);
  res.status(201).json(await overview());
});

// Change a mailbox: sender name, agent, team, on/off, or a new password
emailRouter.patch("/mailboxes/:id", async (req, res) => {
  const box = await findMailbox(req.params.id);
  const b = req.body ?? {};
  const changes = {};
  if ("name" in b)
    changes.name = String(b.name ?? "")
      .trim()
      .slice(0, 100);
  if ("enabled" in b) changes.enabled = Boolean(b.enabled);
  if ("assigneeId" in b) {
    changes.assigneeId = b.assigneeId || null;
    if (changes.assigneeId) {
      const [agent] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, changes.assigneeId),
            inArray(users.role, ["owner", "admin", "agent"]),
          ),
        );
      if (!agent) throw new BadInput("Pick someone from the team.");
    }
  }
  if ("departmentId" in b) {
    changes.departmentId = b.departmentId || null;
    if (changes.departmentId) {
      const [team] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, changes.departmentId));
      if (!team) throw new BadInput("Pick a team from the list.");
    }
  }
  if (b.password && box.provider === "imap") {
    const password = String(b.password);
    await tryMailbox(box, { user: box.username, pass: password });
    changes.secret = seal(password);
    changes.lastError = null;
  }
  if (Object.keys(changes).length)
    await db.update(mailboxes).set(changes).where(eq(mailboxes.id, box.id));
  res.json(await overview());
});

emailRouter.delete("/mailboxes/:id", async (req, res) => {
  const box = await findMailbox(req.params.id);
  await db.delete(mailboxes).where(eq(mailboxes.id, box.id));
  accessTokens.delete(box.id);
  res.json(await overview());
});

// Check for new emails now
emailRouter.post("/mailboxes/:id/check", async (req, res) => {
  const box = await findMailbox(req.params.id);
  await checkMailbox(box);
  res.json(await overview());
});

// Send a test email to yourself from this mailbox
emailRouter.post("/mailboxes/:id/test", async (req, res) => {
  const box = await findMailbox(req.params.id);
  try {
    const auth = await authFor(box);
    await smtpTransport(box, auth).sendMail({
      from: { name: box.name || box.address, address: box.address },
      to: req.user.email,
      subject: "Test email from the helpdesk",
      text: `This is a test from the helpdesk, sent with ${box.address}.\n\nIf you can read this, replies to email tickets will reach your customers.`,
    });
  } catch (err) {
    throw new BadInput(`Sending didn't work: ${explain(err, box)}`);
  }
  res.json({ ok: true, to: req.user.email });
});

// ============================================================

// When the server starts: check the mailboxes every minute, and email
// new replies every 5 seconds
export function startEmailChecks() {
  const report = (err) => console.error("Email:", err);
  setTimeout(() => checkAll().catch(report), 10 * 1000).unref();
  setInterval(() => checkAll().catch(report), CHECK_EVERY).unref();
  setInterval(() => sendNewReplies().catch(report), 5 * 1000).unref();
}
