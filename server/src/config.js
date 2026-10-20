// The server's settings, worked out once before anything else runs
// (db/index.js and index.js import this first).
//
// 1. .env files: server/.env, then a .env next to the whole project.
//    Settings already given by the hosting panel (e.g. SiteGround's
//    Environment Variables) always win over the files.
// 2. HOSTING=siteground: the usual settings for SiteGround's Node.js
//    Projects (production, SiteGround looks after the domain and SSL).
// 3. The database: DATABASE_URL, or the separate parts a hosting panel
//    shows (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD), put
//    together here, so a password with symbols in it just works.
// 4. DATA_DIR: one folder for everything the server saves (attached
//    files, backups, the secret key), so it can live somewhere that's
//    kept when a new version is deployed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const env = process.env;

// ---------- 1. .env files ----------
for (const file of [
  path.join(SERVER_DIR, ".env"),
  path.join(SERVER_DIR, "..", ".env"),
]) {
  try {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  } catch (err) {
    console.warn(`Couldn't read ${file}: ${err.message}`);
  }
}

// Only fills in a setting that isn't there yet
const fallback = (name, value) => {
  if (!env[name]) env[name] = value;
};

// ---------- 2. Hosting presets ----------
if (String(env.HOSTING).toLowerCase() === "siteground") {
  fallback("NODE_ENV", "production");
  fallback("SSL_MODE", "host");
  fallback("HOSTING_COMPANY", "SiteGround");
}

// ---------- 3. The database ----------
// The link, from DATABASE_URL or the separate parts. Exported for
// drizzle.config.js.
export function databaseUrl() {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const name = env.DB_NAME || env.PGDATABASE;
  const user = env.DB_USER || env.PGUSER;
  if (!name || !user) return "";
  const password = env.DB_PASSWORD ?? env.PGPASSWORD ?? "";
  const host = env.DB_HOST || env.PGHOST || "localhost";
  const port = env.DB_PORT || env.PGPORT || "5432";
  // encodeURIComponent: an @, : or / in the password can't break the link
  const login = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `postgres://${login}@${host}:${port}/${encodeURIComponent(name)}`;
}
fallback("DATABASE_URL", databaseUrl());

// A plain-words reason a database problem happened, with what to do
export function explainDatabaseError(err) {
  const message = String(err?.message ?? err);
  const code = err?.code ?? err?.cause?.code;
  if (!env.DATABASE_URL)
    return "No database is set. Add DB_HOST, DB_NAME, DB_USER and DB_PASSWORD (or DATABASE_URL) to the environment variables.";
  if (/mysql/i.test(env.DATABASE_URL))
    return "That's a MySQL database. Uplink needs PostgreSQL: create one under Site → PostgreSQL instead.";
  if (code === "28P01" || /password authentication failed/i.test(message))
    return "The database user or password is wrong. Check DB_USER and DB_PASSWORD.";
  if (code === "3D000" || /database .* does not exist/i.test(message))
    return "There's no database with that name. Check DB_NAME (the full name, as the hosting panel shows it).";
  if (code === "42501" || /permission denied/i.test(message))
    return "The database user isn't allowed to make tables. In the hosting panel, give the user ALL privileges on the database.";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT")
    return `Couldn't reach the database at ${env.DB_HOST || "the address in DATABASE_URL"}. Check DB_HOST and DB_PORT (often localhost and 5432).`;
  return message;
}

// ---------- 4. Where files are saved ----------
// On SiteGround, if DATA_DIR isn't set: a folder in the account's home
// folder, outside the app's code, so a new deployment can't remove it
// (only if it can be made there)
if (
  !env.DATA_DIR &&
  String(env.HOSTING).toLowerCase() === "siteground" &&
  os.homedir()
) {
  const home = path.join(os.homedir(), "uplink-data");
  const outsideApp = path
    .relative(path.resolve(SERVER_DIR, ".."), home)
    .startsWith("..");
  try {
    if (outsideApp) {
      fs.mkdirSync(home, { recursive: true });
      fs.accessSync(home, fs.constants.W_OK);
      env.DATA_DIR = home;
    }
  } catch {
    // Not allowed there: files stay in the app's folder (index.js warns)
  }
}
if (env.DATA_DIR) {
  const dir = path.resolve(env.DATA_DIR);
  fallback("UPLOAD_DIR", path.join(dir, "uploads"));
  fallback("BACKUP_DIR", path.join(dir, "backups"));
  fallback("SECRET_KEY_FILE", path.join(dir, ".secret-key"));
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`Couldn't make DATA_DIR ${dir}: ${err.message}`);
  }
}
