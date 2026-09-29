// The API server. The front end asks it for data at /api/...,
// and it reads and writes the database.
//
// Run with: npm run dev   (restarts by itself when you save a file)

import express from "express";

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

import {
  notificationsRouter,
  pushRouter,
  startDueTimeChecks,
} from "./notify.js";

import { handleBadInput } from "./validate.js";

const app = express();

// Freshdesk imports send tickets in batches with their whole
// conversation, so they're allowed to be bigger. This has to come before
// the normal 1mb limit below, which would refuse them first.

app.use("/api/import", express.json({ limit: "20mb" }));

// A backup being restored is the whole database in one request

app.use("/api/backup/restore", express.json({ limit: "500mb" }));

app.use(express.json({ limit: "1mb" })); // read JSON sent by the front end

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

// Open http://localhost:5173/api/health in the browser to see if the
// server and the database are both working

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

// ---------- The API ----------

app.use("/api/auth", authRouter); // signing in and out

app.use("/api/me", meRouter); // your own profile

app.use("/api/team", teamRouter); // the team, invites, access levels

app.use("/api/invites", inviteRouter); // accepting an invite

app.use("/api/departments", departmentsRouter);

app.use("/api/customers", customersRouter);

app.use("/api/tickets", ticketsRouter);

app.use("/api/answers", answersRouter); // the Knowledge Base

app.use("/api/rules", rulesRouter); // assignment rules

app.use("/api/automations", automationsRouter);

app.use("/api/settings", settingsRouter); // Super Admin only

app.use("/api/import", importRouter); // Freshdesk import (Admins)

app.use("/api/live", liveRouter); // live updates, who's on which page

app.use("/api/notifications", notificationsRouter); // the bell

app.use("/api/push", pushRouter); // desktop/phone notifications on and off

app.use("/api/attachments", attachmentsRouter); // files on tickets

app.use("/api/backup", backupRouter); // backups and restoring (Super Admin)

// Anything else under /api that doesn't exist

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Problems with what was sent (e.g. "Enter a valid email address.")

app.use(handleBadInput);

// Anything else: show a short message instead of crashing

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) return next(err);

  res.status(500).json({ error: "Something went wrong on the server." });
});

const port = Number(process.env.PORT) || 4000;

// 0.0.0.0 allows Render to reach the server.
// Locally, it will still use port 4000 unless PORT is set.

app.listen(port, "0.0.0.0", () => {
  console.log(`API running on port ${port}`);

  // Every 5 minutes: warn about tickets that are due soon or overdue

  startDueTimeChecks();

  // Every hour: clear out files that were uploaded but never sent

  startFileCleanUp();

  // Every 5 minutes: time-based automations ("no reply for 24 hours")

  startAutomations();

  // Every hour: an automatic backup, if one is due

  startAutomaticBackups();
});
