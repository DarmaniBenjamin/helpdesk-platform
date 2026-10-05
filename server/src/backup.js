// Backups and restoring, straight from and into the database.
//
// A backup is one JSON file with every row of every table that matters:
// departments, customers, the team (with their scrambled passwords, so
// everyone can still sign in after a restore), tickets with their whole
// conversation and history, file records, the Knowledge Base, rules,
// automations and settings (including the SLA targets), and the email
// mailboxes (their passwords stay locked with this server's key, see
// secrets.js, so on another server they need signing in again). It
// doesn't hold sign-in sessions or notifications (those don't matter
// after a restore), or the attached files themselves (those are in the
// uploads folder: back that up too).
//
// Keep backup files somewhere safe: they hold everything, including
// customers' details.
//
//   GET  /api/backup/download       a fresh backup, as a download
//   POST /api/backup/run            save a backup on the server now
//   GET  /api/backup/saved          the backups saved on the server
//   GET  /api/backup/saved/:name    download one of them
//   POST /api/backup/restore        restore from an uploaded file
//   POST /api/backup/restore-saved  restore from one saved on the server
// All Super Admin only.
//
// Automatic backups: every hour the server checks whether one is due
// (daily or weekly, from Settings), saves it in the backups folder, and
// keeps only the newest few. The folder is BACKUP_DIR in server/.env
// (default: server/backups).
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "./db/index.js";
import { settings } from "./db/schema.js";
import { hashToken, requireRole } from "./auth.js";
import { BadInput } from "./validate.js";
import { forgetSla } from "./sla.js";

export const backupRouter = Router();

const APP = "helpdesk-platform";
const VERSION = 2;
const HOUR = 60 * 60 * 1000;

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// The tables in a backup, in the order they're put back (a table comes
// after the ones it points to). Their names are the real database names.
const TABLES = [
  "departments",
  "customers",
  "users",
  "user_departments",
  "mailboxes",
  "held_emails",
  "tickets",
  "messages",
  "attachments",
  "email_messages",
  "answers",
  "rules",
  "automations",
  "automation_runs",
  "settings",
];
// Tables whose "id" counts up by itself: after a restore, the counter
// carries on after the highest one
const COUNTED = [
  "mailboxes",
  "held_emails",
  "customers",
  "tickets",
  "messages",
  "answers",
  "rules",
  "automations",
];

// "helpdesk-backup-2026-09-29-1430.json"
function fileNameFor(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return `helpdesk-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
const NAME_PATTERN = /^helpdesk-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.json$/;

// ---------- Making a backup ----------

export async function makeBackup() {
  const tables = {};
  for (const table of TABLES) {
    const { rows } = await pool.query(`select * from "${table}"`);
    tables[table] = rows;
  }
  return { app: APP, version: VERSION, exportedAt: Date.now(), tables };
}

// Remembers when the last backup was made (shown in Settings)
async function rememberBackupTime(time) {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "backup"));
  const value = { ...(row?.value ?? {}), lastBackupAt: time };
  await db
    .insert(settings)
    .values({ key: "backup", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

// The saved backups, newest first
function savedBackups() {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => NAME_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, at: stat.mtimeMs };
    })
    .sort((a, b) => b.at - a.at);
}

// Something to do after each backup is saved on the server: offsite.js
// sends a copy to the cloud. Set with afterBackupSaved(fn).
let afterSave = null;
export function afterBackupSaved(fn) {
  afterSave = fn;
}

// Saves a backup in the backups folder and deletes the oldest ones, so
// only the newest `keep` are left
async function saveBackup(keep) {
  const backup = await makeBackup();
  let name = fileNameFor(backup.exportedAt);
  // Two in the same minute: add a number
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++)
    name = fileNameFor(backup.exportedAt).replace(".json", `-${i}.json`);
  await fs.promises.writeFile(
    path.join(BACKUP_DIR, name),
    JSON.stringify(backup),
  );
  for (const old of savedBackups().slice(keep))
    await fs.promises.unlink(path.join(BACKUP_DIR, old.name)).catch(() => {});
  await rememberBackupTime(backup.exportedAt);
  // A copy to the cloud too, if that's set up (in the background)
  if (afterSave)
    afterSave(path.join(BACKUP_DIR, name), keep).catch((err) =>
      console.error("Off-site copy:", err.message),
    );
  return name;
}

async function backupSettings() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "backup"));
  return { schedule: "daily", keep: 14, lastBackupAt: null, ...row?.value };
}

// ---------- Checking a backup before restoring it ----------

function checkBackup(backup) {
  if (
    backup?.app !== APP ||
    !backup.tables ||
    typeof backup.tables !== "object"
  )
    throw new BadInput("This isn't a helpdesk backup file.");
  if (backup.version !== VERSION)
    throw new BadInput(
      backup.version < VERSION
        ? "This backup was made before restoring was possible, so it can't be restored. Download a new backup instead."
        : "This backup is from a newer version of the app. Update first.",
    );
  for (const table of TABLES) {
    if (!Array.isArray(backup.tables[table] ?? []))
      throw new BadInput(`The backup's ${table} are damaged.`);
  }
  // Never restore something nobody can sign in to
  const owner = (backup.tables.users ?? []).find(
    (u) => u.role === "owner" && u.status === "active" && u.password_hash,
  );
  if (!owner)
    throw new BadInput(
      "This backup has no Super Admin who can sign in, so restoring it would lock everyone out.",
    );
}

// What's inside a backup, for showing after restoring
function summaryOf(backup) {
  const count = (t) => backup.tables[t]?.length ?? 0;
  return {
    exportedAt: backup.exportedAt,
    tickets: count("tickets"),
    customers: count("customers"),
    team: (backup.tables.users ?? []).filter((u) => u.role !== "customer")
      .length,
    answers: count("answers"),
    rules: count("rules"),
    automations: count("automations"),
  };
}

// ---------- Restoring ----------

// Replaces everything in the database with the backup, all in one go:
// if anything fails, nothing is changed. The person restoring stays
// signed in if they're in the backup; everyone else signs in again.
export async function restore(backup, req) {
  checkBackup(backup);
  const token = (req.headers.cookie ?? "")
    .split(";")
    .map((p) => p.trim().split("="))
    .find(([k]) => k === "helpdesk_session")?.[1];

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Everything goes, including sign-ins, invite links and notifications
    // (they belong to the old data)
    await client.query(
      `truncate ${TABLES.map((t) => `"${t}"`).join(", ")}, "sessions", "tokens", "notifications", "push_subscriptions" restart identity cascade`,
    );
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      if (rows.length === 0) continue;
      // Postgres turns the JSON rows back into table rows by column name.
      // "overriding system value" keeps every ID exactly as it was.
      for (let i = 0; i < rows.length; i += 2000) {
        await client.query(
          `insert into "${table}" overriding system value select * from json_populate_recordset(null::"${table}", $1)`,
          [JSON.stringify(rows.slice(i, i + 2000))],
        );
      }
    }
    for (const table of COUNTED) {
      await client.query(
        `select setval(pg_get_serial_sequence('"${table}"', 'id'), coalesce((select max(id) from "${table}"), 1), (select count(*) > 0 from "${table}"))`,
      );
    }
    // Keep the person restoring signed in, if they're in the backup
    if (token) {
      const { rows } = await client.query(
        `select id from users where id = $1 and status = 'active'`,
        [req.user.id],
      );
      if (rows.length) {
        await client.query(
          `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`,
          [hashToken(decodeURIComponent(token)), req.user.id],
        );
      }
    }
    await client.query("commit");
    // The SLA targets came back with the settings: read them again
    forgetSla();
  } catch (err) {
    await client.query("rollback");
    if (err instanceof BadInput) throw err;
    console.error("Restore failed:", err);
    throw new BadInput(
      `The backup couldn't be restored, and nothing was changed: ${err.message}`,
    );
  } finally {
    client.release();
  }
  return summaryOf(backup);
}

// ================================================================
// The routes (Super Admin only)
// ================================================================

backupRouter.use(requireRole("owner"));

backupRouter.get("/download", async (req, res) => {
  const backup = await makeBackup();
  await rememberBackupTime(backup.exportedAt);
  res.attachment(fileNameFor(backup.exportedAt));
  res.type("application/json").send(JSON.stringify(backup));
});

backupRouter.post("/run", async (req, res) => {
  const { keep } = await backupSettings();
  const name = await saveBackup(keep);
  res.status(201).json({ name, saved: savedBackups() });
});

backupRouter.get("/saved", (req, res) => {
  res.json(savedBackups());
});

backupRouter.get("/saved/:name", (req, res) => {
  const name = String(req.params.name);
  if (!NAME_PATTERN.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name)))
    throw new BadInput("That backup doesn't exist.", 404);
  res.download(path.join(BACKUP_DIR, name), name);
});

// The backup file itself is the body of the request
backupRouter.post("/restore", async (req, res) => {
  res.json(await restore(req.body, req));
});

backupRouter.post("/restore-saved", async (req, res) => {
  const name = String(req.body?.name ?? "");
  if (!NAME_PATTERN.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name)))
    throw new BadInput("That backup doesn't exist.", 404);
  let backup;
  try {
    backup = JSON.parse(
      await fs.promises.readFile(path.join(BACKUP_DIR, name), "utf8"),
    );
  } catch {
    throw new BadInput("That backup file is damaged.");
  }
  res.json(await restore(backup, req));
});

// ================================================================
// Automatic backups
// ================================================================

async function backupIfDue() {
  const { schedule, keep } = await backupSettings();
  if (schedule === "off") return;
  const every = schedule === "weekly" ? 7 * 24 * HOUR : 24 * HOUR;
  // Due when the newest one saved on the server is old enough
  // (downloads don't count: they aren't kept on the server)
  const lastSaved = savedBackups()[0]?.at ?? 0;
  if (Date.now() - lastSaved < every) return;
  const name = await saveBackup(keep);
  console.log(`Automatic backup saved: ${name}`);
}

export function startAutomaticBackups() {
  const run = () =>
    backupIfDue().catch((err) =>
      console.error("Automatic backup failed:", err.message),
    );
  run();
  setInterval(run, HOUR);
}
