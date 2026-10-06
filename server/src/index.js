// The server. It answers the front end's requests at /api/..., reads and
// writes the database, and on the live site (Render) it also serves the
// website itself, so everything comes from one address.
//
// Run with: npm run dev   (restarts by itself when you save a file)
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { tickets } from "./db/schema.js";
import { authRouter, loadSession } from "./auth.js";
import {
  teamRouter,
  meRouter,
  inviteRouter,
  departmentsRouter,
} from "./team.js";
import { customersRouter } from "./customers.js";
import { ticketsRouter } from "./tickets.js";
import { answersRouter } from "./answers.js";
import { rulesRouter, automationsRouter, settingsRouter } from "./setup.js";
import { importRouter } from "./import.js";
import { liveRouter, sendToEveryone } from "./live.js";
import { attachmentsRouter, startFileCleanUp } from "./attachments.js";
import { startAutomations } from "./automation.js";
import { backupRouter, startAutomaticBackups } from "./backup.js";
import { offsiteRouter } from "./offsite.js";
import { setupOwnerRouter } from "./setup-owner.js";
import { jobsRouter, startJobReminders } from "./jobs.js";
import { freshdeskRouter } from "./freshdesk.js";
import { slaRouter } from "./sla.js";
import { requestsRouter } from "./requests.js";
import { domainsRouter, seedSiteDomains } from "./domains.js";
import { startCaddySync } from "./caddy.js";
import { emailRouter, reviewRouter, startEmailChecks } from "./email.js";
import {
  feedbackRouter,
  passwordRouter,
  rememberSite,
  startFeedbackEmails,
} from "./notices.js";
import {
  notificationsRouter,
  pushRouter,
  startDueTimeChecks,
} from "./notify.js";
import { handleBadInput } from "./validate.js";

const app = express();

// On Render, requests reach this server through Render's own proxy.
// This tells Express to trust it, so it knows the site is on https.
app.set("trust proxy", 1);

// Freshdesk imports send tickets in batches with their whole
// conversation, so they're allowed to be bigger. This has to come before
// the normal 1mb limit below, which would refuse them first.
app.use("/api/import", express.json({ limit: "20mb" }));
// A backup being restored is the whole database in one request
app.use("/api/backup/restore", express.json({ limit: "500mb" }));
app.use(express.json({ limit: "1mb" })); // read JSON sent by the front end

// ---------- Safety settings for browsers ----------
// Standard instructions sent with every answer, which tell browsers to
// be careful with the site:
//   - never guess a file's type (stops a disguised file running as a page)
//   - don't tell other websites which page a link was clicked on
//   - this site never needs the camera or microphone, and only uses
//     location itself (saving a customer's location, see location.js)
//   - only this site can show its pages inside a frame, so another
//     website can't hide it inside theirs to trick people into clicking.
//     The one exception is the request form (/request), which is made
//     to be put on your own website.
//   - on the live site: always use the secure https address
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  });
  if (!req.path.startsWith("/request"))
    res.set("Content-Security-Policy", "frame-ancestors 'self'");
  if (process.env.NODE_ENV === "production")
    res.set("Strict-Transport-Security", "max-age=31536000");
  next();
});

// Work out who is signed in (from their session cookie) on every request
app.use(loadSession);

// ---------- Live updates ----------
// After anything is changed (added, edited, deleted), every open tab of
// everyone signed in is told what changed, so it can load it again and
// show it without a refresh. The tab that made the change says who it
// is (X-Tab-Id), so it doesn't load its own change twice. For tickets,
// the message also says whose ticket it is, so customers only hear
// about their own (see live.js).
const LIVE = [
  "tickets",
  "customers",
  "answers",
  "rules",
  "automations",
  "team",
  "me",
  "invites",
  "departments",
  "settings",
  "import",
  "backup",
  "sla",
  "jobs",
];
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  // Keep what's sent back, e.g. the ID of a ticket that was just made
  const json = res.json.bind(res);
  res.json = (body) => {
    res.locals.sent = body;
    return json(body);
  };
  res.on("finish", async () => {
    if (res.statusCode >= 400) return;
    const [resource, id, more] = req.originalUrl
      .split("?")[0]
      .replace(/^\/api\//, "")
      .split("/");
    if (!LIVE.includes(resource)) return;
    const change = {
      resource,
      id: id ?? res.locals.sent?.id ?? null,
      deleted: req.method === "DELETE" && Boolean(id) && !more,
      tab: req.get("x-tab-id") ?? null,
    };
    // Whose ticket it is, so that customer's tabs update too
    if (resource === "tickets") {
      change.customerId = res.locals.sent?.customerId ?? null;
      if (!change.customerId && Number(change.id)) {
        const [row] = await db
          .select({ customerId: tickets.customerId })
          .from(tickets)
          .where(eq(tickets.id, Number(change.id)))
          .catch(() => []);
        change.customerId = row?.customerId ?? null;
      }
    }
    sendToEveryone("changed", change);
  });
  next();
});

// ---------- Health check ----------
// Open /api/health in the browser to see if the server and the database
// are both working. Render also checks it to know the site is up.
app.get("/api/health", async (req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ server: "ok", database: "connected" });
  } catch (err) {
    res
      .status(503)
      .json({ server: "ok", database: "not connected", error: err.message });
  }
});

// The site's address, for links in emails the server sends on its own
// (e.g. feedback requests, see notices.js): noted whenever the app opens
app.use("/api/auth/me", (req, res, next) => {
  if (req.user) rememberSite(req);
  next();
});

// ---------- The API ----------
app.use("/api/auth", authRouter); // signing in and out
app.use("/api/me", meRouter); // your own profile
app.use("/api/team", teamRouter); // the team, invites, access levels
app.use("/api/invites", inviteRouter); // accepting an invite
app.use("/api/departments", departmentsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/answers", answersRouter); // the Knowledge Base
app.use("/api/jobs", jobsRouter); // the calendar: scheduled jobs
app.use("/api/rules", rulesRouter); // assignment rules
app.use("/api/automations", automationsRouter);
app.use("/api/settings", settingsRouter); // Super Admin only
app.use("/api/import", importRouter); // Freshdesk import (Admins)
app.use("/api/live", liveRouter); // live updates, who's on which page
app.use("/api/notifications", notificationsRouter); // the bell
app.use("/api/push", pushRouter); // desktop/phone notifications on and off
app.use("/api/attachments", attachmentsRouter); // files on tickets
app.use("/api/backup/offsite", offsiteRouter); // copies in the cloud (Super Admin)
app.use("/api/backup", backupRouter); // backups and restoring (Super Admin)
app.use("/api/sla", slaRouter); // SLA targets (changed by Admins)
app.use("/api/requests", requestsRouter); // the public request form (no sign-in)
app.use("/api/domains", domainsRouter); // own domain + SSL (Super Admin; Caddy asks /allowed)
app.use("/api/email", emailRouter); // Integrations → Email (Admins)
app.use("/api/email-review", reviewRouter); // emails waiting for a decision (staff)
app.use("/api/password", passwordRouter); // "forgot password" (no sign-in)
app.use("/api/setup-owner", setupOwnerRouter); // the first Super Admin (new servers)
app.use("/api/feedback", feedbackRouter); // "how did we do?" links (no sign-in)
app.use("/freshdesk-api", freshdeskRouter); // reading from Freshdesk (Admins)

// Anything else under /api that doesn't exist
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---------- The website ----------
// On the live site, the built website ("npm run build" makes the dist
// folder) is served from here too. Any address that isn't a file (like
// /inbox or /tickets/12) gets index.html, and the app shows the right
// page. While developing, Vite does this instead and dist isn't needed.
const site = path.resolve(import.meta.dirname, "../../dist");
if (fs.existsSync(path.join(site, "index.html"))) {
  app.use(
    express.static(site, {
      index: false,
      setHeaders(res, file) {
        // Built files have a fingerprint in their name, so they can be
        // kept for a year; everything else is checked each time
        if (file.includes(`${path.sep}assets${path.sep}`))
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        else res.set("Cache-Control", "no-cache");
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(site, "index.html"));
  });
}

// Problems with what was sent (e.g. "Enter a valid email address.")
app.use(handleBadInput);

// Anything else: show a short message instead of crashing
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

// Render tells the server which port to use (PORT). Locally it's 4000.
// HOST: 0.0.0.0 (the default) = reachable from outside this computer,
// which Render needs. On your own server, set HOST=127.0.0.1 so only
// Caddy (on the same server) can reach it, and everyone goes through
// https.
const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`Server running on ${host}:${port}`);
  // Every 5 minutes: warn about tickets that are due soon or overdue
  startDueTimeChecks();
  // Every hour: clear out files that were uploaded but never sent
  startFileCleanUp();
  // Every 5 minutes: time-based automations ("no reply for 24 hours")
  startAutomations();
  // Every hour: an automatic backup, if one is due
  startAutomaticBackups();
  // The site's main domain (SITE_DOMAIN) on the Domain & SSL list, then,
  // if Caddy is installed on this computer, give it the https settings
  seedSiteDomains();
  startCaddySync();
  // Every minute: new emails in the connected mailboxes become tickets
  startEmailChecks();
  // Every minute: "how did we do?" emails for newly resolved tickets
  startFeedbackEmails();
  // Every minute: "your job starts in 30 minutes" reminders
  startJobReminders();
});
