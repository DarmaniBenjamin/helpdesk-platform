// What the phone (phone.js) and WhatsApp (whatsapp.js) integrations share:
// finding a customer by phone number, and making a ticket, adding to one,
// or saving a file on one, with everything else a new ticket or reply
// sets off (history line, assignment rules, automations, notifications,
// live updates), the same as an email does in email.js.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  attachments,
  customers,
  departments,
  messages,
  tickets,
  users,
} from "./db/schema.js";
import { MAX_FILE_SIZE, UPLOAD_DIR } from "./attachments.js";
import { getSla } from "./sla.js";
import { recordEvent } from "./activity.js";
import { afterTicketEvent } from "./automation.js";
import {
  onCustomerReply,
  onTicketAssigned,
  onTicketCreated,
} from "./notify.js";
import { sendToEveryone } from "./live.js";

const HOUR = 60 * 60 * 1000;
export const MAX_BODY = 20000;
const STAFF = ["owner", "admin", "agent"];

// ---------- Phone numbers ----------

export const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

// A number written the usual way: +1 473-555-1234, 473-555-1234, 555-1234
export function prettyPhone(value) {
  const d = digitsOf(value);
  if (d.length === 11 && d[0] === "1")
    return `+1 ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d.length > 11 ? `+${d}` : d;
}

// The customer with this phone number (main or extra), or nobody.
// Numbers are compared by their last 7 digits, because they're typed
// every way: "+1 (473) 555-1234", "4735551234", or just "555-1234"
// without the area code. If several customers match, the one whose last
// 10 digits match too wins.
export async function findCustomerByPhone(number) {
  const d = digitsOf(number);
  if (d.length < 7) return null;
  const last7 = d.slice(-7);
  const tidy = (column) => sql`regexp_replace(${column}, '[^0-9]', '', 'g')`;
  const rows = await db
    .select()
    .from(customers)
    .where(
      sql`right(${tidy(customers.phone)}, 7) = ${last7}
        or exists (select 1 from unnest(${customers.extraPhones}) p
                   where right(regexp_replace(p, '[^0-9]', '', 'g'), 7) = ${last7})`,
    )
    .limit(20);
  if (rows.length <= 1) return rows[0] ?? null;
  const last10 = d.slice(-10);
  const numbersOf = (c) => [c.phone, ...c.extraPhones].map(digitsOf);
  return (
    rows.find((c) => numbersOf(c).some((n) => n.slice(-10) === last10)) ??
    rows[0]
  );
}

// The customer with this number, or a new one (named after what the
// caller or WhatsApp says their name is, else the number itself)
export async function customerForPhone(number, name) {
  const found = await findCustomerByPhone(number);
  if (found) return found;
  const phone = prettyPhone(number);
  const [made] = await db
    .insert(customers)
    .values({
      name: (name || "").trim().slice(0, 100) || phone || "Unknown caller",
      email: null,
      phone,
    })
    .returning();
  return made;
}

// The one customer callers with a hidden number go on
export async function unknownCaller() {
  const [found] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.name, "Unknown caller"),
        eq(customers.phone, ""),
        sql`${customers.email} is null`,
      ),
    )
    .limit(1);
  if (found) return found;
  const [made] = await db
    .insert(customers)
    .values({ name: "Unknown caller", email: null, phone: "" })
    .returning();
  return made;
}

// ---------- People and teams ----------

// The staff member with this ID, if they're still active
export async function activeStaff(userId) {
  if (!userId) return null;
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, "active"),
        inArray(users.role, STAFF),
      ),
    );
  return user ?? null;
}

// The active staff member with this email address, if any
export async function staffByEmail(address) {
  const email = String(address ?? "")
    .trim()
    .toLowerCase();
  if (!email) return null;
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.email, email),
        eq(users.status, "active"),
        inArray(users.role, STAFF),
      ),
    );
  return user ?? null;
}

// Every active staff member, for the pickers on the settings pages
export async function staffList() {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(inArray(users.role, STAFF), eq(users.status, "active")))
    .orderBy(users.name);
}

export async function teamList() {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .orderBy(departments.name);
}

// The team's ID if it still exists, else null (it was deleted)
export async function existingTeam(departmentId) {
  if (!departmentId) return null;
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, String(departmentId)));
  return d?.id ?? null;
}

// ---------- Tickets ----------

export const isDone = (status) => status === "resolved" || status === "closed";

export function announce(ticket) {
  sendToEveryone("changed", {
    resource: "tickets",
    id: ticket.id,
    customerId: ticket.customerId,
  });
}

export async function getTicket(id) {
  if (!id) return null;
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
  return ticket ?? null;
}

// A new ticket, with what the customer said (or the call) as its first
// message. createdBody: the history line, e.g. "left a voicemail".
// Returns { ticket, messageId }.
export async function createInboundTicket({
  customer,
  subject,
  body,
  authorName,
  source,
  assigneeId = null,
  departmentId = null,
  tags = [],
  priority = 2,
  createdBody,
  at = new Date(),
}) {
  const assignee = await activeStaff(assigneeId);
  const team = await existingTeam(departmentId);
  const sla = await getSla();
  const text = String(body ?? "").slice(0, MAX_BODY);
  const [ticket] = await db
    .insert(tickets)
    .values({
      subject: String(subject || "(no subject)").slice(0, 200),
      description: text,
      status: "open",
      priority,
      departmentId: team,
      assigneeId: assignee?.id ?? null,
      customerId: customer.id,
      source,
      tags: tags.slice(0, 20),
      firstResponseDue: new Date(at.getTime() + sla[priority].firstResponse * HOUR),
      dueBy: new Date(at.getTime() + sla[priority].resolve * HOUR),
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  const [msg] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      kind: "customer",
      authorName,
      body: text || "(nothing written)",
      createdAt: at,
    })
    .returning({ id: messages.id });
  await recordEvent({
    ticket,
    actor: { id: null, name: authorName },
    type: "created",
    body: createdBody,
    at: new Date(at.getTime() + 1),
  });
  // Assignment rules, automations, and the Admins' "New ticket" notification
  await afterTicketEvent(ticket.id, "created");
  onTicketCreated(ticket, authorName, { id: null });
  if (assignee)
    onTicketAssigned(ticket, assignee.id, { id: null, name: authorName });
  announce(ticket);
  return { ticket, messageId: msg.id };
}

// The customer said more on a ticket that's still going. A ticket that
// was waiting on them, or marked resolved, goes back in the queue.
// Returns the new message's ID.
export async function addCustomerMessage(
  ticket,
  { authorName, body, at = new Date(), reopenedBody },
) {
  const reopen = ["waiting", "resolved"].includes(ticket.status);
  const text = String(body ?? "").slice(0, MAX_BODY);
  const [msg] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      kind: "customer",
      authorName,
      body: text || "(nothing written)",
      createdAt: at,
    })
    .returning({ id: messages.id });
  await db
    .update(tickets)
    .set({
      updatedAt: at,
      ...(reopen ? { status: "open", resolvedAt: null, closedAt: null } : {}),
    })
    .where(eq(tickets.id, ticket.id));
  if (reopen)
    await recordEvent({
      ticket,
      actor: { id: null, name: authorName },
      type: "status:open",
      body: reopenedBody,
      at: new Date(at.getTime() + 1),
    });
  onCustomerReply(ticket, authorName, text || "Sent a file");
  await afterTicketEvent(ticket.id, "customerReply");
  if (reopen) await afterTicketEvent(ticket.id, "statusChanged", "open");
  announce(ticket);
  return msg.id;
}

// A reply the agent sent outside the helpdesk (e.g. from the WhatsApp
// Business app on their phone), copied onto the ticket. The first one
// counts as the ticket's first response, like a reply sent from here.
export async function addAgentMessage(
  ticket,
  { authorId = null, authorName, body, channel, at = new Date() },
) {
  const [msg] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      kind: "agent",
      authorId,
      authorName,
      body: String(body ?? "").slice(0, MAX_BODY) || "(nothing written)",
      channel,
      createdAt: at,
    })
    .returning({ id: messages.id });
  await db
    .update(tickets)
    .set({
      updatedAt: at,
      ...(ticket.firstRespondedAt ? {} : { firstRespondedAt: at }),
    })
    .where(eq(tickets.id, ticket.id));
  announce(ticket);
  return msg.id;
}

// An internal note (e.g. a recorded call, or "Called for 3 min")
export async function addNote(
  ticket,
  { authorName, body, channel = null, at = new Date() },
) {
  const [msg] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      kind: "note",
      authorId: null,
      authorName,
      body: String(body ?? "").slice(0, MAX_BODY),
      channel,
      createdAt: at,
    })
    .returning({ id: messages.id });
  await db
    .update(tickets)
    .set({ updatedAt: at })
    .where(eq(tickets.id, ticket.id));
  announce(ticket);
  return msg.id;
}

// ---------- Files ----------

// The kinds of file kept from calls and messages (the same as files people
// can attach in the helpdesk, plus voicemail and voice note audio)
const KEPT_FILES = new Set(
  "jpg jpeg png gif webp heic heif bmp pdf txt log csv rtf doc docx xls xlsx ppt pptx odt ods eml msg zip 7z rar gz mp4 mov webm 3gp wav mp3 m4a ogg opus aac amr".split(
    " ",
  ),
);

// A tidy file name: no folders, no odd characters, not too long
function cleanFileName(name) {
  const base = path
    .basename(String(name || "file"))
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "file").slice(-150);
}

// Saves one file onto a message, in the uploads folder like any other
// attachment. Returns where it was saved ({ file, fileName }), or null if
// it's a kind of file that isn't allowed, or too big.
export async function saveFile({ fileName, content, ticketId, messageId }) {
  const name = cleanFileName(fileName);
  const ending = path.extname(name).slice(1).toLowerCase();
  if (!KEPT_FILES.has(ending) || !content?.length) return null;
  if (content.length > MAX_FILE_SIZE) return null;
  const storageKey = `${crypto.randomUUID()}.${ending}`;
  const file = path.join(UPLOAD_DIR, storageKey);
  await fs.promises.writeFile(file, content);
  await db.insert(attachments).values({
    ticketId,
    messageId,
    uploadedById: null,
    fileName: name,
    size: content.length,
    storageKey,
  });
  return { file, fileName: name };
}

const AUDIO = new Set(["wav", "mp3", "m4a", "ogg", "opus", "aac", "amr"]);
export const isAudio = (fileName) =>
  AUDIO.has(path.extname(String(fileName)).slice(1).toLowerCase());

// The usual file ending for a type of file, e.g. "audio/ogg; codecs=opus"
// -> "ogg"
const ENDINGS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};
export const endingForType = (type) =>
  ENDINGS[String(type ?? "").split(";")[0].trim().toLowerCase()] ?? "bin";

// "0:42", "3:05", "1:02:10"
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
