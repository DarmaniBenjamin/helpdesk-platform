// Starting the server: npm start (here, or in the project's main folder).
//
//   1. bring the database up to date (db/migrate.js) and add what a new
//      helpdesk needs (db/seed.js)
//   2. start the helpdesk (index.js)
//
// If the database can't be reached yet (wrong password, not created...),
// the server still starts, but only to show what's wrong: the site and
// /api/health say why, in plain words, instead of the site just not
// answering. It tries again every 30 seconds, and the helpdesk opens by
// itself as soon as the database works (e.g. after fixing the
// environment variables and restarting).
import { spawn } from "node:child_process";
import pg from "pg";
import http from "node:http";
import path from "node:path";
import { explainDatabaseError } from "./config.js";

const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const RETRY_EVERY = 30 * 1000;

// Runs one of the database scripts. Resolves with its output, or rejects
// with an error holding it.
function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("src", "db", script)], {
      cwd: SERVER_DIR,
      env: process.env,
    });
    let output = "";
    const keep = (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(Object.assign(new Error(output.trim()), { output })),
    );
  });
}

// Where the tables go. Normally the database's "public" area, but on
// newer PostgreSQL (15+) a database user that doesn't own the database
// often isn't allowed to make tables there, even with all privileges
// (common on shared hosting). Then they go in their own area, "uplink",
// which the user is allowed to make. DB_SCHEMA can also be set by hand.
async function pickSchema() {
  if (process.env.DB_SCHEMA) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const {
      rows: [r],
    } = await client.query(
      `select has_schema_privilege(current_user, 'public', 'CREATE') as can,
              exists (select 1 from pg_namespace where nspname = 'uplink') as has`,
    );
    if (r.has || !r.can) {
      await client.query("create schema if not exists uplink");
      process.env.DB_SCHEMA = "uplink";
      console.log('Tables are in the database\'s "uplink" area.');
    }
  } finally {
    await client.end();
  }
}

async function prepareDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error(explainDatabaseError(new Error("no database")));
  try {
    await pickSchema();
  } catch (err) {
    throw new Error(explainDatabaseError(err), { cause: err });
  }
  await run("migrate.js");
  await run("seed.js");
}

// The last line of what went wrong, in plain words where possible
function reasonFor(err) {
  const text = String(err?.message ?? err);
  const last =
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? text;
  const codes = {
    "password authentication failed": "28P01",
    "does not exist": "3D000",
    "permission denied": "42501",
    ECONNREFUSED: "ECONNREFUSED",
    ENOTFOUND: "ENOTFOUND",
    ETIMEDOUT: "ETIMEDOUT",
  };
  const code = Object.entries(codes).find(([words]) =>
    last.includes(words),
  )?.[1];
  return code ? explainDatabaseError({ message: last, code }) : last;
}

// ---------- While the database isn't working ----------

function waitingPage(reason) {
  const safe = reason.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c],
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Uplink: starting</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6f8;color:#101828;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:#fff;border:1px solid #eaecf0;border-radius:16px;padding:24px;max-width:520px}
h1{font-size:20px;margin:0 0 8px}p{color:#667085;line-height:1.5}
code{display:block;background:#fef3f2;color:#b42318;border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word}</style></head>
<body><main><h1>The helpdesk can't reach its database yet</h1>
<code>${safe}</code>
<p>Fix the setting, then restart the app (or wait: it tries again every 30 seconds, and this page reloads by itself).</p></main></body></html>`;
}

function listenTarget() {
  const port = process.env.PORT;
  // Some hosts hand over a socket file instead of a port number
  if (port && !/^\d+$/.test(port)) return [port];
  return [Number(port) || 4000, process.env.HOST || "0.0.0.0"];
}

let reason = "";
let waiting = null;

function startWaitingServer() {
  waiting = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          server: "ok",
          database: "not connected",
          error: reason,
        }),
      );
    }
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    res.end(waitingPage(reason));
  });
  waiting.listen(...listenTarget(), () =>
    console.log("Waiting for the database; the site shows why."),
  );
}

async function openHelpdesk() {
  if (waiting)
    await new Promise((done) => {
      waiting.close(done);
      waiting.closeAllConnections();
    });
  waiting = null;
  await import("./index.js");
}

async function attempt() {
  try {
    await prepareDatabase();
    await openHelpdesk();
  } catch (err) {
    reason = reasonFor(err);
    console.error(`The database isn't ready: ${reason}`);
    if (!waiting) startWaitingServer();
    setTimeout(attempt, RETRY_EVERY);
  }
}

attempt();
