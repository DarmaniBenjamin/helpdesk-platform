// The API server. The front end asks it for data at /api/...,
// and it reads and writes the database.
//
// Run with: npm run dev   (restarts by itself when you save a file)
import express from "express";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
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
import { handleBadInput } from "./validate.js";

const app = express();
// Freshdesk imports send tickets in batches with their whole
// conversation, so they're allowed to be bigger. This has to come before
// the normal 1mb limit below, which would refuse them first.
app.use("/api/import", express.json({ limit: "20mb" }));
app.use(express.json({ limit: "1mb" })); // read JSON sent by the front end

// Work out who is signed in (from their session cookie) on every request
app.use(loadSession);

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
// 127.0.0.1 = only this computer can reach it directly. Your phone still
// works, because it goes through the Vite dev server (see vite.config.js).
app.listen(port, "127.0.0.1", () => {
  console.log(`API running on http://localhost:${port}`);
});
