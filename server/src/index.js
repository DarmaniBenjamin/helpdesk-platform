// The API server. The front end asks it for data at /api/...,
// and it reads and writes the database.
//
// Run with: npm run dev   (restarts by itself when you save a file)
import express from "express";
import { asc, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { departments } from "./db/schema.js";

const app = express();
app.use(express.json({ limit: "1mb" })); // read JSON sent by the front end

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

// ---------- Departments ----------
// The first real data coming from the database. The rest of the app
// (tickets, customers, team...) moves over the same way, one step at a time.

app.get("/api/departments", async (req, res) => {
  const list = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .orderBy(asc(departments.name));
  res.json(list);
});

// Anything else under /api that doesn't exist
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Errors: show a short message instead of crashing
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
