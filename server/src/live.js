// The live connection. Every open tab of everyone signed in (staff and
// customers, as many as there are) keeps one connection to the server
// (called Server-Sent Events: the server can send messages down it at
// any time). It's used for:
//   1. Live updates: when something changes, every tab is told, so it
//      shows the change without a refresh (see index.js)
//   2. New notifications, so the bell updates straight away (staff)
//   3. Who's on which page (the eye in the top bar) (staff)
// Customers only ever hear about their own tickets.
//
//   GET  /api/live           opens the connection
//   POST /api/live/presence  { connectionId, path } "I'm on this page now"
//
// Nothing here is saved in the database: when the server restarts,
// every tab simply connects again by itself.
import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth, requireRole } from "./auth.js";
import { STAFF } from "./permissions.js";

export const liveRouter = Router();

// Every open tab: id -> { userId, staff, customerId, res, path, since }
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

// Tells every open tab that something changed. Staff hear about
// everything. A customer only hears about their own tickets (the
// change says whose ticket it is: customerId), and about a restore.
// Things that want to know whenever something changes (e.g. offsite.js,
// which copies the database to the cloud soon after any change)
const changeListeners = [];
export function onEveryChange(fn) {
  changeListeners.push(fn);
}

export function sendToEveryone(event, data) {
  if (event === "changed")
    for (const fn of changeListeners) {
      try {
        fn(data);
      } catch {
        // a listener's problem isn't the change's problem
      }
    }
  for (const c of connections.values()) {
    if (c.staff) {
      send(c.res, event, data);
    } else if (
      event === "changed" &&
      ((data.resource === "tickets" &&
        data.customerId &&
        data.customerId === c.customerId) ||
        data.resource === "backup")
    ) {
      // Customers don't need to know which tab or ticket owner it was
      send(c.res, event, { resource: data.resource, id: data.id });
    }
  }
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

// Who's where is only for staff
function sendPresenceToEveryone() {
  const list = presenceList();
  for (const c of connections.values())
    if (c.staff) send(c.res, "presence", list);
}

// Open the live connection. It stays open until the tab closes.
liveRouter.get("/", requireAuth, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // tells proxies not to hold messages back
  });
  res.flushHeaders();

  const id = crypto.randomUUID();
  const staff = STAFF.includes(req.user.role);
  connections.set(id, {
    userId: req.user.id,
    staff,
    customerId: req.user.customerId ?? null,
    res,
    path: null,
    since: Date.now(),
  });
  send(res, "hello", { connectionId: id });
  if (staff) send(res, "presence", presenceList());

  // A tiny message every 25 seconds, so nothing in between thinks the
  // connection is dead and closes it
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(ping);
    connections.delete(id);
    if (staff) sendPresenceToEveryone();
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
