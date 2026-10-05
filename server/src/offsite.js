// Off-site copies of the backups (Settings → Backup & Restore), so a
// lost or broken server doesn't take everything with it.
//
// Each time a backup is saved on the server (every day or week, or "Save
// on the server"), a copy goes to cloud storage too:
//   - Backblaze B2 (10 GB free), Cloudflare R2 (10 GB free), Wasabi,
//     Amazon S3, or anything else that speaks "S3"
//   - only the newest ones are kept there, the same number as on the
//     server
// A copy holds everything needed to start again on a new server:
//   - the backup itself (the whole database)
//   - the uploads folder (every attached file)
//   - this server's secret key (secrets.js), so mailbox passwords and
//     sign-ins to Microsoft/Google still work after restoring
// It's locked with a backup password (AES-256-GCM, with the key made from
// the password by scrypt) before it leaves the server, so the storage
// company (or anyone who gets into the bucket) only ever sees scrambled
// data. Keep the backup password somewhere safe outside the helpdesk
// (a password manager): without it, the copies can't be opened.
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
// All Super Admin only.
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
function keyFor(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

// file → MAGIC | salt (16) | iv (12) | locked data | tag (16)
async function lockFile(from, to, password) {
  const salt = crypto.randomBytes(16);
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

// ---------- Packing: backup + uploads + key, in one .tar.gz ----------

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

async function pack(backupFile, into) {
  const stage = path.join(into, "stage");
  await fs.promises.mkdir(stage);
  await fs.promises.copyFile(backupFile, path.join(stage, "backup.json"));
  await fs.promises.writeFile(path.join(stage, "secret-key"), currentKey(), {
    mode: 0o600,
  });
  const archive = path.join(into, "copy.tar.gz");
  // The uploads folder goes in as "uploads", wherever it is on this server
  await run("tar", [
    "-czf",
    archive,
    "-C",
    stage,
    "backup.json",
    "secret-key",
    "-C",
    path.dirname(UPLOAD_DIR),
    path.basename(UPLOAD_DIR),
  ]);
  return { archive, uploadsName: path.basename(UPLOAD_DIR) };
}

// ---------- Copying to the cloud ----------

// "helpdesk-backup-2026-10-05-143012.uplink" (to the second, so two
// copies made in the same minute don't overwrite each other)
function cloudName(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `helpdesk-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.uplink`;
}

let copying = false;

// Locks a saved backup (with the uploads and key) and uploads it, then
// keeps only the newest `keep` copies there
async function copyToCloud(backupFile, keep) {
  const config = await loadConfig();
  if (!config) return;
  if (copying) throw new Error("A copy is already being made.");
  copying = true;
  const job = await workFolder();
  try {
    const { archive, uploadsName } = await pack(backupFile, job);
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
        Metadata: { uploads: uploadsName },
      },
    }).done();

    // Only the newest `keep` copies stay in the cloud
    const copies = await listCopies(config);
    for (const old of copies.slice(keep))
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: `${prefix(config)}${old.name}`,
        }),
      );
    await saveConfig({ ...config, lastCopyAt: Date.now(), lastError: null });
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

// Every backup saved on the server gets a copy (backup.js calls this)
afterBackupSaved(async (file, keep) => {
  if (await loadConfig()) await copyToCloud(file, keep);
});

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
    const stamp = new Date(backup.exportedAt);
    const pad = (n) => String(n).padStart(2, "0");
    const file = path.join(
      job,
      `helpdesk-backup-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`,
    );
    await fs.promises.writeFile(file, JSON.stringify(backup));
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "backup"));
    try {
      await copyToCloud(file, row?.value?.keep ?? 14);
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

    // The attached files (added next to any already here)
    const files = path.join(unpacked, uploadsName);
    if (fs.existsSync(files))
      await fs.promises.cp(files, UPLOAD_DIR, { recursive: true, force: true });

    res.json(summary);
  } finally {
    await fs.promises.rm(job, { recursive: true, force: true });
  }
});
