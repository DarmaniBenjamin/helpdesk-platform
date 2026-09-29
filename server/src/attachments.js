// Attachments: photos, PDFs, zip files and so on, added to a ticket's
// conversation (a reply, an internal note, or a customer's request).
//
// How it works:
// 1. The file is uploaded on its own first (POST /api/attachments),
//    as soon as it's picked. It's saved in the uploads folder under a
//    random name, and gets a record with no message yet.
// 2. When the reply, note or request is sent, the IDs of its files go
//    with it, and tickets.js joins them to that message (claimFiles).
// 3. Anyone who can see the message can open its files
//    (GET /api/attachments/:id). Customers never see files on internal
//    notes, or files on other people's tickets.
// Files that were uploaded but never sent are cleared out after a day.
//
// The uploads folder is set with UPLOAD_DIR in server/.env (default:
// server/uploads). Keep it out of git, and back it up with the database.
import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "./db/index.js";
import { attachments, messages, tickets } from "./db/schema.js";
import { requireAuth } from "./auth.js";
import { STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";

export const attachmentsRouter = Router();

const MB = 1024 * 1024;
export const MAX_FILE_SIZE = 25 * MB;
export const MAX_FILES_PER_MESSAGE = 10;

// Where the files are kept
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The kinds of files allowed, by their ending, and what type the
// browser is told they are. Anything else (programs, scripts, web
// pages) is refused, so nobody can upload something harmful.
const FILE_TYPES = {
  // Photos: shown right in the conversation
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  // Documents
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  // Archives
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  // Videos and screen recordings
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
// Photos the browser can show in the page. Everything else downloads.
const SHOWN_IN_PAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

const endingOf = (name) => path.extname(name).slice(1).toLowerCase();

// A tidy file name: no folders, no odd characters, not too long
function cleanFileName(name) {
  const base = path
    .basename(String(name || "file"))
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_")
    .trim();
  return (base || "file").slice(-150);
}

// What the front end gets for a file
export function publicAttachment(a) {
  return {
    id: a.id,
    name: a.fileName,
    size: a.size,
    image: SHOWN_IN_PAGE.has(endingOf(a.fileName)),
  };
}

// ---------- Uploading ----------

// Saves straight into the uploads folder under a random name
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, done) =>
      done(
        null,
        `${crypto.randomUUID()}.${endingOf(file.originalname) || "bin"}`,
      ),
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_MESSAGE },
  fileFilter: (req, file, done) => {
    // Browsers send the name in a way that can garble accents; fix it
    file.originalname = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    if (FILE_TYPES[endingOf(file.originalname)]) return done(null, true);
    done(
      new BadInput(
        `"${cleanFileName(file.originalname)}" can't be attached. Photos, PDFs, Office documents, text files, videos and zip files are fine.`,
      ),
    );
  },
});

// Runs multer and turns its errors into plain messages
function receiveFiles(req, res, next) {
  upload.array("files", MAX_FILES_PER_MESSAGE)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof BadInput) return next(err);
    if (err.code === "LIMIT_FILE_SIZE")
      return next(
        new BadInput(`Each file can be up to ${MAX_FILE_SIZE / MB} MB.`),
      );
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE")
      return next(
        new BadInput(`Up to ${MAX_FILES_PER_MESSAGE} files at a time.`),
      );
    next(err);
  });
}

// Upload one or more files (form field "files"). Anyone signed in can,
// staff and customers. Returns the files, ready to send with a message.
attachmentsRouter.post("/", requireAuth, receiveFiles, async (req, res) => {
  const files = req.files ?? [];
  if (files.length === 0) throw new BadInput("Pick a file to attach.");
  const rows = await db
    .insert(attachments)
    .values(
      files.map((f) => ({
        uploadedById: req.user.id,
        fileName: cleanFileName(f.originalname),
        size: f.size,
        storageKey: f.filename,
      })),
    )
    .returning();
  res.status(201).json(rows.map(publicAttachment));
});

// ---------- Joining files to a message (used by tickets.js) ----------

// Checks the file IDs sent with a message: they must be files this
// person uploaded and hasn't sent yet. Throws if any aren't.
export async function checkFiles(ids, user) {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) throw new BadInput("Those files aren't valid.");
  const wanted = [...new Set(ids.map(String))];
  if (wanted.length === 0) return [];
  if (wanted.length > MAX_FILES_PER_MESSAGE)
    throw new BadInput(`Up to ${MAX_FILES_PER_MESSAGE} files per message.`);
  const found = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        inArray(attachments.id, wanted),
        eq(attachments.uploadedById, user.id),
        isNull(attachments.messageId),
      ),
    );
  if (found.length !== wanted.length)
    throw new BadInput(
      "Some of those files couldn't be found. Try attaching them again.",
    );
  return wanted;
}

// Joins checked files to the message they were sent with
export async function claimFiles(ids, ticketId, messageId) {
  if (ids.length === 0) return;
  await db
    .update(attachments)
    .set({ ticketId, messageId })
    .where(and(inArray(attachments.id, ids), isNull(attachments.messageId)));
}

// The files on these messages: message ID -> list of files
export async function filesForMessages(messageIds) {
  if (messageIds.length === 0) return {};
  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds))
    .orderBy(attachments.createdAt);
  const byMessage = {};
  for (const a of rows)
    (byMessage[a.messageId] ??= []).push(publicAttachment(a));
  return byMessage;
}

// The stored names of a ticket's files. Get these before deleting the
// ticket (its file records go with it), then pass them to removeFiles.
export async function filesOfTicket(ticketId) {
  const rows = await db
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.ticketId, ticketId));
  return rows.map((r) => r.storageKey);
}

// The stored names of one message's files (e.g. a note being deleted)
export async function filesOfMessage(messageId) {
  const rows = await db
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.messageId, messageId));
  return rows.map((r) => r.storageKey);
}

// Deletes files from the uploads folder
export function removeFiles(storageKeys) {
  storageKeys.forEach(removeFile);
}

function removeFile(storageKey) {
  fs.promises
    .unlink(path.join(UPLOAD_DIR, storageKey))
    .catch((err) => err.code !== "ENOENT" && console.error(err.message));
}

// ---------- Opening a file ----------

attachmentsRouter.get("/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .select({
      file: attachments,
      messageKind: messages.kind,
      customerId: tickets.customerId,
    })
    .from(attachments)
    .leftJoin(messages, eq(attachments.messageId, messages.id))
    .leftJoin(tickets, eq(attachments.ticketId, tickets.id))
    .where(eq(attachments.id, String(req.params.id)));

  const file = row?.file;
  const isStaff = STAFF.includes(req.user.role);
  const allowed =
    file &&
    (file.messageId === null
      ? // Not sent yet: only whoever uploaded it
        file.uploadedById === req.user.id
      : isStaff ||
        // A customer: their own ticket, and never internal notes
        (row.customerId === req.user.customerId &&
          row.messageKind !== "note" &&
          row.messageKind !== "event"));
  if (!allowed) throw new BadInput("That file doesn't exist.", 404);

  const ending = endingOf(file.fileName);
  const where = path.join(UPLOAD_DIR, file.storageKey);
  if (!fs.existsSync(where))
    throw new BadInput("That file is missing from the server.", 404);

  res.set({
    "Content-Type": FILE_TYPES[ending] ?? "application/octet-stream",
    // Never treat the file as anything other than what it says it is
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=86400",
  });
  // Photos open in the page; everything else downloads. ?download=1
  // downloads photos too.
  const inline = SHOWN_IN_PAGE.has(ending) && !req.query.download;
  res.attachment(file.fileName);
  if (inline)
    res.set(
      "Content-Disposition",
      res.get("Content-Disposition").replace(/^attachment/, "inline"),
    );
  res.sendFile(where);
});

// ---------- Tidying up ----------

// Every hour: files uploaded but never sent (older than a day), and
// files left in the folder with no record (e.g. their ticket was deleted
// while the server was off)
const DAY = 24 * 60 * 60 * 1000;

async function cleanUp() {
  const old = new Date(Date.now() - DAY);
  const unsent = await db
    .delete(attachments)
    .where(and(isNull(attachments.messageId), lt(attachments.createdAt, old)))
    .returning({ storageKey: attachments.storageKey });
  unsent.forEach((r) => removeFile(r.storageKey));

  const known = new Set(
    (await db.select({ key: attachments.storageKey }).from(attachments)).map(
      (r) => r.key,
    ),
  );
  for (const name of await fs.promises.readdir(UPLOAD_DIR)) {
    if (known.has(name)) continue;
    const stat = await fs.promises.stat(path.join(UPLOAD_DIR, name));
    if (stat.isFile() && Date.now() - stat.mtimeMs > DAY) removeFile(name);
  }
}

export function startFileCleanUp() {
  const run = () =>
    cleanUp().catch((err) => console.error("File clean-up:", err.message));
  run();
  setInterval(run, 60 * 60 * 1000);
}
