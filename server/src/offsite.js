// Off-site copies of the backups (Settings → Backup & Restore), so a
// lost or broken server doesn't take everything with it.
//
// Copies go to cloud storage: Backblaze B2 (10 GB free), Cloudflare R2
// (10 GB free), Wasabi, Amazon S3, or anything else that speaks "S3".
//
// When: within 10 minutes of any change (a new ticket, a reply, a new
// customer...), at most once every 10 minutes, so at worst 10 minutes of
// work could ever be lost. Also with every backup saved on the server
// (every day or week, or "Save on the server"), and with "Copy now".
//
// What, in the folder in the bucket:
//   helpdesk-backup-<date>.uplink   the whole database and this server's
//                                   secret key (secrets.js), so mailbox
//                                   passwords and Microsoft/Google
//                                   sign-ins still work after restoring
//   files/...                       every attached file, each uploaded
//                                   once, when it's new (not again with
//                                   every copy)
//
// Versions: every copy from the last 48 hours is kept, then one a day for
// 30 days, then one a week for 3 months; older ones are deleted. Lots of
// recent versions to go back to, while the storage stays small.
//
// Each copy and file is locked with a backup password (AES-256-GCM, with
// the key made from the password by scrypt) before it leaves the server,
// so the storage company (or anyone who gets into the bucket) only ever
// sees scrambled data. Keep the backup password somewhere safe outside
// the helpdesk (a password manager): without it, the copies can't be
// opened.
//
// The settings (bucket, keys, password) are kept in the settings table,
// the secrets locked with secrets.js. Nothing to put in server/.env.
//
//   GET    /api/backup/offsite            the settings (no secrets) and status
//   PUT    /api/backup/offsite            save them (after checking they work)
//   DELETE /api/backup/offsite            stop making copies
//   POST   /api/backup/offsite/send       make a backup and copy it now
//   GET    /api/backup/offsite/copies     the copies in the cloud
//   POST   /api/backup/offsite/restore    { name } restore one of them
// All Super Admin only. Restoring brings back the database and the key
// from the copy, then downloads any attached files this server doesn't
// have (all of them, on a new server).
//
// Restoring on a new server: set up the helpdesk, sign in as the Super
// Admin, fill in the same storage details and backup password here, then
// Restore the newest copy.
import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { BadInput } from "./validate.js";
import { seal, unseal, currentKey, replaceKey } from "./secrets.js";
import { UPLOAD_DIR } from "./attachments.js";
import { onEveryChange } from "./live.js";
import { BACKUP_DIR, afterBackupSaved, makeBackup, restore } from "./backup.js";

export const offsiteRouter = Router();
offsiteRouter.use(requireRole("owner"));

const WORK_DIR = path.join(BACKUP_DIR, ".offsite");
const MAGIC = Buffer.from("UPLINK-OFFSITE-1"); // 16 bytes, starts every copy
const NAME_PATTERN = /^helpdesk-backup-[\w-]+\.uplink$/;

// Ready-made settings for the common providers
const PROVIDERS = {
  b2: { label: "Backblaze B2" },
  r2: { label: "Cloudflare R2" },
  s3: { label: "Amazon S3" },
  other: { label: "Other (S3-compatible)" },
};

// ---------- The settings ----------

async function loadConfig() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "offsite"));
  return row?.value ?? null;
}

async function saveConfig(value) {
  await db
    .insert(settings)
    .values({ key: "offsite", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

// What the page sees: never the secret key or the password
function publicConfig(config) {
  if (!config) return { enabled: false };
  return {
    enabled: true,
    provider: config.provider,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    folder: config.folder,
    keyId: config.keyId,
    lastCopyAt: config.lastCopyAt ?? null,
    lastError: config.lastError ?? null,
    filesInCloud: config.filesInCloud ?? 0,
  };
}

function client(config, secretKey) {
  return new S3Client({
    region: config.region || "auto",
    endpoint: config.endpoint || undefined,
    // Most non-Amazon storage wants the bucket in the path
    forcePathStyle: Boolean(config.endpoint),
    credentials: { accessKeyId: config.keyId, secretAccessKey: secretKey },
  });
}

const prefix = (config) => (config.folder ? `${config.folder}/` : "");

// Plain words for what went wrong talking to the storage
function explain(err) {
  const code = err?.name || err?.Code || "";
  if (
    /InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized|Forbidden|AccessDenied/i.test(
      code,
    ) ||
    err?.$metadata?.httpStatusCode === 403
  )
    return "The storage didn't accept the key ID and secret key (or the key isn't allowed to use this bucket).";
  if (/NoSuchBucket/i.test(code) || err?.$metadata?.httpStatusCode === 404)
    return "That bucket doesn't exist (check its name, and the endpoint's region).";
  if (/ENOTFOUND|EAI_AGAIN/.test(err?.code ?? err?.message ?? ""))
    return "Couldn't find the storage's endpoint. Check its address.";
  return `The storage said: ${String(err?.message || code || err).slice(0, 200)}`;
}

// ---------- Locking and unlocking with the backup password ----------

// The key for the password and salt (scrypt: slow on purpose, so the
// password can't be guessed quickly)
// (Keys already worked out are remembered, since attached files all use
// the same salt for a while, and working one out takes a moment)
const keys = new Map();
function keyFor(password, salt) {
  const id = `${crypto.createHash("sha256").update(String(password)).digest("hex")}:${salt.toString("hex")}`;
  if (!keys.has(id)) {
    if (keys.size > 50) keys.clear();
    keys.set(
      id,
      crypto.scryptSync(String(password), salt, 32, {
        N: 2 ** 15,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }),
    );
  }
  return keys.get(id);
}

// One salt for the attached files while the server runs (each file still
// gets its own random IV, so no two are locked the same way)
const FILE_SALT = crypto.randomBytes(16);

// file → MAGIC | salt (16) | iv (12) | locked data | tag (16)
async function lockFile(from, to, password, salt = crypto.randomBytes(16)) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    keyFor(password, salt),
    iv,
  );
  const out = fs.createWriteStream(to);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(from), cipher, out, { end: false });
  await new Promise((resolve, reject) =>
    out.end(cipher.getAuthTag(), (err) => (err ? reject(err) : resolve())),
  );
}

async function unlockFile(from, to, password) {
  const { size } = await fs.promises.stat(from);
  const handle = await fs.promises.open(from, "r");
  const head = Buffer.alloc(44);
  const tag = Buffer.alloc(16);
  try {
    await handle.read(head, 0, 44, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  if (size < 60 || !head.subarray(0, 16).equals(MAGIC))
    throw new BadInput("That isn't one of the helpdesk's off-site copies.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFor(password, head.subarray(16, 32)),
    head.subarray(32, 44),
  );
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(from, { start: 44, end: size - 17 }),
      decipher,
      fs.createWriteStream(to),
    );
  } catch {
    throw new BadInput("The backup password is wrong, or the copy is damaged.");
  }
}

// ---------- Packing: backup + key, in one .tar.gz ----------

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (d) => (errors += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed: ${errors.slice(0, 300)}`)),
    );
  });
}

// A fresh folder to work in, removed afterwards
async function workFolder() {
  await fs.promises.mkdir(WORK_DIR, { recursive: true });
  return fs.promises.mkdtemp(path.join(WORK_DIR, "job-"));
}

// The database and key (attached files go up on their own, see syncFiles)
async function pack(backupFile, into) {
  const stage = path.join(into, "stage");
  await fs.promises.mkdir(stage);
  await fs.promises.copyFile(backupFile, path.join(stage, "backup.json"));
  await fs.promises.writeFile(path.join(stage, "secret-key"), currentKey(), {
    mode: 0o600,
  });
  const archive = path.join(into, "copy.tar.gz");
  await run("tar", ["-czf", archive, "-C", stage, "backup.json", "secret-key"]);
  return { archive };
}

// ---------- Copying to the cloud ----------

// "helpdesk-backup-2026-10-05-143012.uplink" (to the second, so two
// copies made in the same minute don't overwrite each other)
function cloudName(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `helpdesk-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.uplink`;
}

let copying = false;

// Which copies to delete: every copy from the last 48 hours stays, then
// the newest of each day for 30 days, then the newest of each week for
// about 3 months (and always the 3 newest)
function oldVersions(copies, now = Date.now()) {
  const HOUR = 60 * 60 * 1000;
  const keep = new Set(copies.slice(0, 3).map((c) => c.name));
  const days = new Set();
  const weeks = new Set();
  for (const c of copies) {
    const age = now - c.at;
    if (age <= 48 * HOUR) keep.add(c.name);
    else if (age <= 30 * 24 * HOUR) {
      const day = new Date(c.at).toDateString();
      if (!days.has(day)) {
        days.add(day);
        keep.add(c.name);
      }
    } else if (age <= 91 * 24 * HOUR) {
      const week = Math.floor(c.at / (7 * 24 * HOUR));
      if (!weeks.has(week)) {
        weeks.add(week);
        keep.add(c.name);
      }
    }
  }
  return copies.filter((c) => !keep.has(c.name));
}

// Locks a saved backup (with the key) and uploads it, then thins out the
// older versions (see oldVersions)
async function copyToCloud(backupFile) {
  const config = await loadConfig();
  if (!config) return;
  if (copying) throw new Error("A copy is already being made.");
  copying = true;
  const job = await workFolder();
  try {
    const { archive } = await pack(backupFile, job);
    const locked = path.join(job, "copy.uplink");
    await lockFile(archive, locked, unseal(config.password));

    const s3 = client(config, unseal(config.secretKey));
    const name = cloudName(new Date());
    await new Upload({
      client: s3,
      params: {
        Bucket: config.bucket,
        Key: `${prefix(config)}${name}`,
        Body: fs.createReadStream(locked),
      },
    }).done();

    const copies = await listCopies(config);
    for (const old of oldVersions(copies))
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: `${prefix(config)}${old.name}`,
        }),
      );
    lastSnapshotAt = Date.now();
    await saveConfig({
      ...(await loadConfig()),
      lastCopyAt: Date.now(),
      lastError: null,
    });
  } catch (err) {
    await saveConfig({
      ...config,
      lastError: err instanceof BadInput ? err.message : explain(err),
    });
    throw err;
  } finally {
    copying = false;
    await fs.promises.rm(job, { recursive: true, force: true });
  }
}

// The copies in the cloud, newest first
async function listCopies(config) {
  const s3 = client(config, unseal(config.secretKey));
  const found = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix(config),
        Delimiter: "/", // not the files/ folder
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents ?? []) {
      const name = item.Key.slice(prefix(config).length);
      if (NAME_PATTERN.test(name))
        found.push({
          name,
          size: item.Size,
          at: item.LastModified ? item.LastModified.getTime() : null,
        });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return found.sort((a, b) => b.at - a.at);
}

// ---------- Attached files: each one uploaded once ----------

// Every file in the uploads folder (and its folders), as paths inside it
async function localFiles(dir = UPLOAD_DIR, base = "") {
  const found = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory())
      found.push(...(await localFiles(path.join(dir, e.name), rel)));
    else if (e.isFile()) found.push(rel);
  }
  return found;
}

// The files already in the cloud (looked up once, then kept up to date)
let uploaded = null;
let uploadedFor = "";

async function remoteFiles(config, s3) {
  const where = `${config.bucket}/${prefix(config)}`;
  if (uploaded && uploadedFor === where) return uploaded;
  const set = new Set();
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: `${prefix(config)}files/`,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents ?? [])
      set.add(item.Key.slice(`${prefix(config)}files/`.length));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  uploaded = set;
  uploadedFor = where;
  return set;
}

let syncing = false;

// Uploads the attached files that aren't in the cloud yet, each locked
// with the backup password
async function syncFiles() {
  const config = await loadConfig();
  if (!config || syncing) return;
  syncing = true;
  const job = await workFolder();
  try {
    const s3 = client(config, unseal(config.secretKey));
    const there = await remoteFiles(config, s3);
    const password = unseal(config.password);
    let added = 0;
    for (const rel of await localFiles()) {
      if (there.has(rel)) continue;
      const locked = path.join(job, "file.uplink");
      await lockFile(path.join(UPLOAD_DIR, rel), locked, password, FILE_SALT);
      await new Upload({
        client: s3,
        params: {
          Bucket: config.bucket,
          Key: `${prefix(config)}files/${rel}`,
          Body: fs.createReadStream(locked),
        },
      }).done();
      there.add(rel);
      added++;
    }
    if (added || config.filesInCloud !== there.size)
      await saveConfig({
        ...(await loadConfig()),
        filesInCloud: there.size,
        lastFilesAt: Date.now(),
      });
  } finally {
    syncing = false;
    await fs.promises.rm(job, { recursive: true, force: true });
  }
}

// Restoring: downloads the attached files this server doesn't have
async function restoreFiles(config, s3) {
  const job = await workFolder();
  let count = 0;
  try {
    const password = unseal(config.password);
    uploaded = null; // look again
    for (const rel of await remoteFiles(config, s3)) {
      const target = path.join(UPLOAD_DIR, rel);
      // (never outside the uploads folder)
      if (!target.startsWith(UPLOAD_DIR + path.sep)) continue;
      if (fs.existsSync(target)) continue;
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: `${prefix(config)}files/${rel}`,
        }),
      );
      const locked = path.join(job, "file.uplink");
      await pipeline(object.Body, fs.createWriteStream(locked));
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await unlockFile(locked, target, password);
      count++;
    }
  } finally {
    await fs.promises.rm(job, { recursive: true, force: true });
  }
  return count;
}

// ---------- When copies are made ----------

// Every backup saved on the server gets a copy (backup.js calls this)
afterBackupSaved(async (file) => {
  if (!(await loadConfig())) return;
  await copyToCloud(file);
  await syncFiles();
});

// Soon after any change: a fresh copy of the database (at most every 10
// minutes), and any new attached files
const SNAPSHOT_EVERY = 10 * 60 * 1000;
let changed = false;
let lastSnapshotAt = 0;
onEveryChange((data) => {
  // (restoring a backup isn't new work to copy)
  if (data?.resource !== "backup") changed = true;
});

async function snapshot() {
  const job = await workFolder();
  try {
    const backup = await makeBackup();
    const file = path.join(job, "backup.json");
    await fs.promises.writeFile(file, JSON.stringify(backup));
    await copyToCloud(file);
  } finally {
    await fs.promises.rm(job, { recursive: true, force: true });
  }
}

async function copyIfChanged() {
  if (copying || !(await loadConfig())) return;
  if (changed && Date.now() - lastSnapshotAt >= SNAPSHOT_EVERY) {
    changed = false;
    try {
      await snapshot();
    } catch (err) {
      changed = true; // try again next time
      throw err;
    }
  }
  await syncFiles();
}

export function startOffsiteCopies() {
  const run = () =>
    copyIfChanged().catch((err) =>
      console.error("Off-site copy:", err.message),
    );
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, 60 * 1000).unref();
}

// ---------- The routes ----------

offsiteRouter.get("/", async (req, res) => {
  res.json({ config: publicConfig(await loadConfig()), providers: PROVIDERS });
});

// Save the settings, after checking the storage accepts them. Secrets
// left empty keep the saved ones (they're never sent back to the page).
offsiteRouter.put("/", async (req, res) => {
  const b = req.body ?? {};
  const before = (await loadConfig()) ?? {};
  const text = (v) => String(v ?? "").trim();
  const config = {
    provider: PROVIDERS[b.provider] ? b.provider : "other",
    endpoint: text(b.endpoint),
    region: text(b.region),
    bucket: text(b.bucket),
    folder: text(b.folder).replace(/^\/+|\/+$/g, ""),
    keyId: text(b.keyId),
    secretKey: text(b.secretKey) ? seal(text(b.secretKey)) : before.secretKey,
    password: b.password ? seal(String(b.password)) : before.password,
    lastCopyAt: before.lastCopyAt ?? null,
    lastError: null,
  };
  // Backblaze B2's region is in its endpoint (s3.us-east-005.backblaze…);
  // Cloudflare R2 doesn't use regions
  if (!config.region && config.provider === "b2")
    config.region =
      config.endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2/)?.[1] ?? "";
  if (!config.region && config.provider === "r2") config.region = "auto";
  // https only (plain http just for storage on this same computer)
  if (
    config.endpoint &&
    !/^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(
      config.endpoint,
    )
  )
    throw new BadInput("The endpoint should start with https://");
  if (!config.bucket) throw new BadInput("Enter the bucket's name.");
  if (!config.keyId || !config.secretKey)
    throw new BadInput("Enter the key ID and the secret key.");
  if (!config.password)
    throw new BadInput("Choose a backup password (at least 10 characters).");
  if (b.password && String(b.password).length < 10)
    throw new BadInput("Make the backup password at least 10 characters.");

  // Does the storage accept these? (Listing the folder is enough to tell)
  try {
    await listCopies(config);
  } catch (err) {
    throw new BadInput(explain(err));
  }
  await saveConfig(config);
  res.json({ config: publicConfig(config), providers: PROVIDERS });
});

offsiteRouter.delete("/", async (req, res) => {
  await db.delete(settings).where(eq(settings.key, "offsite"));
  res.json({ config: publicConfig(null), providers: PROVIDERS });
});

// Make a backup now and copy it to the cloud (waits until it's there)
offsiteRouter.post("/send", async (req, res) => {
  const config = await loadConfig();
  if (!config) throw new BadInput("Set up the cloud storage first.");
  const job = await workFolder();
  try {
    const backup = await makeBackup();
    const file = path.join(job, "backup.json");
    await fs.promises.writeFile(file, JSON.stringify(backup));
    try {
      await copyToCloud(file);
      await syncFiles();
    } catch (err) {
      throw new BadInput(err instanceof BadInput ? err.message : explain(err));
    }
  } finally {
    await fs.promises.rm(job, { recursive: true, force: true });
  }
  const fresh = await loadConfig();
  res.json({
    config: publicConfig(fresh),
    copies: await listCopies(fresh),
  });
});

offsiteRouter.get("/copies", async (req, res) => {
  const config = await loadConfig();
  if (!config) return res.json([]);
  try {
    res.json(await listCopies(config));
  } catch (err) {
    throw new BadInput(explain(err));
  }
});

// Restore one of the cloud copies: the database, the attached files and
// the secret key all come back. Everyone else is signed out (like a
// normal restore); whoever restores stays signed in if they're in it.
offsiteRouter.post("/restore", async (req, res) => {
  const config = await loadConfig();
  if (!config) throw new BadInput("Set up the cloud storage first.");
  const name = String(req.body?.name ?? "");
  if (!NAME_PATTERN.test(name))
    throw new BadInput("That copy doesn't exist.", 404);

  const job = await workFolder();
  try {
    // Download
    const s3 = client(config, unseal(config.secretKey));
    let object;
    try {
      object = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: `${prefix(config)}${name}`,
        }),
      );
    } catch (err) {
      throw new BadInput(explain(err));
    }
    const locked = path.join(job, "copy.uplink");
    await pipeline(object.Body, fs.createWriteStream(locked));
    // (copies made before attached files went up on their own have an
    // uploads folder inside them)
    const uploadsName = object.Metadata?.uploads || "uploads";

    // Unlock and unpack
    const archive = path.join(job, "copy.tar.gz");
    await unlockFile(locked, archive, unseal(config.password));
    const unpacked = path.join(job, "unpacked");
    await fs.promises.mkdir(unpacked);
    await run("tar", ["-xzf", archive, "-C", unpacked]);

    // The key first: the restored settings were locked with it
    const keyFile = path.join(unpacked, "secret-key");
    const oldKey = currentKey();
    if (fs.existsSync(keyFile))
      replaceKey(await fs.promises.readFile(keyFile, "utf8"));

    // The database (checks the backup and does it all at once)
    let summary;
    try {
      const backup = JSON.parse(
        await fs.promises.readFile(path.join(unpacked, "backup.json"), "utf8"),
      );
      summary = await restore(backup, req);
    } catch (err) {
      replaceKey(oldKey); // nothing changed: keep this server's key
      throw err;
    }

    // The attached files: from inside older copies, and any this server
    // doesn't have from the cloud's files/ folder
    const files = path.join(unpacked, uploadsName);
    if (fs.existsSync(files))
      await fs.promises.cp(files, UPLOAD_DIR, { recursive: true, force: true });
    const downloaded = await restoreFiles(config, s3);

    res.json({ ...summary, filesDownloaded: downloaded });
  } finally {
    await fs.promises.rm(job, { recursive: true, force: true });
  }
});