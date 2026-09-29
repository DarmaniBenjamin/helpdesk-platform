// The live connection. Every open staff tab keeps one connection to the
// server (called Server-Sent Events: the server can send messages down
// it at any time). It's used for two things:
//   1. Who's on which page (the eye in the top bar), for real
//   2. New notifications, so the bell updates without refreshing
//
//   GET  /api/live           opens the connection
//   POST /api/live/presence  { connectionId, path } "I'm on this page now"
//
// Nothing here is saved in the database: when the server restarts,
// every tab simply connects again by itself.
import { Router } from "express";
import crypto from "node:crypto";
import { requireRole } from "./auth.js";
import { STAFF } from "./permissions.js";

export const liveRouter = Router();

// Every open tab: id -> { userId, res, path, since }
const connections = new Map();

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Sends something to every open tab of one person
export function sendToUser(userId, event, data) {
  for (const c of connections.values()) {
    if (c.userId === userId) send(c.res, event, data);
  }
}

// Sends something to every open tab (they're all staff)
export function sendToEveryone(event, data) {
  for (const c of connections.values()) send(c.res, event, data);
}

// Who's on which page: one line per person per page. If someone has the
// same page open in two tabs, the one opened first counts.
function presenceList() {
  const seen = new Map();
  for (const c of connections.values()) {
    if (!c.path) continue;
    const key = `${c.userId}|${c.path}`;
    const before = seen.get(key);
    if (!before || c.since < before.since) {
      seen.set(key, { userId: c.userId, path: c.path, since: c.since });
    }
  }
  return [...seen.values()];
}

function sendPresenceToEveryone() {
  const list = presenceList();
  for (const c of connections.values()) send(c.res, "presence", list);
}

// Open the live connection. It stays open until the tab closes.
liveRouter.get("/", requireRole(...STAFF), (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // tells proxies not to hold messages back
  });
  res.flushHeaders();

  const id = crypto.randomUUID();
  connections.set(id, {
    userId: req.user.id,
    res,
    path: null,
    since: Date.now(),
  });
  send(res, "hello", { connectionId: id });
  send(res, "presence", presenceList());

  // A tiny message every 25 seconds, so nothing in between thinks the
  // connection is dead and closes it
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(ping);
    connections.delete(id);
    sendPresenceToEveryone();
  });
});

// A tab tells the server which page it's on (every time you move)
liveRouter.post("/presence", requireRole(...STAFF), (req, res) => {
  const c = connections.get(String(req.body?.connectionId ?? ""));
  if (!c || c.userId !== req.user.id) {
    return res.status(404).json({ error: "Not connected." });
  }
  const path = String(req.body?.path ?? "").slice(0, 200);
  if (path !== c.path) {
    c.path = path;
    c.since = Date.now(); // "here for 3 min" counts from arriving on the page
    sendPresenceToEveryone();
  }
  res.json({ ok: true });
});
