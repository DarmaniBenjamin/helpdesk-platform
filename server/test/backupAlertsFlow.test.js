// The backup gateway's alerts, end to end (backupAlerts.js + alerts.js):
// a new problem, the same one again, getting worse, back to normal, and
// coming back. The database is an in-memory stand-in that understands the
// queries these files make. Run: cd server && npm test
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- An in-memory database ----
const rows = {}; // table name -> [rows]
const ids = {};
const table = (name) =>
  new Proxy({ _table: name }, { get: (t, prop) => (prop in t ? t[prop] : { table: name, name: prop }) });
const tables = Object.fromEntries(
  ["alerts", "alertEvents", "backupAlerts", "backupClients", "backupEvents", "customers", "departments",
   "messages", "settings", "tickets", "users", "userDepartments"].map((n) => [n, table(n)]),
);
const list = (name) => (rows[name] ??= []);
const matches = (row, cond) => !cond || cond(row);
const thenable = (run) => ({ then: (ok, bad) => Promise.resolve().then(run).then(ok, bad) });

function select() {
  const q = {};
  const api = {
    from: (t) => ((q.t = t._table), api),
    innerJoin: () => api,
    leftJoin: () => api,
    where: (c) => ((q.c = c), api),
    orderBy: () => ((q.desc = true), api),
    limit: (n) => ((q.n = n), api),
    groupBy: () => api,
    ...thenable(() => {
      let found = list(q.t).filter((r) => matches(r, q.c));
      if (q.desc) found = [...found].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      return q.n ? found.slice(0, q.n) : found;
    }),
  };
  return api;
}
function insert(t) {
  const name = t._table;
  return {
    values: (v) => {
      const items = (Array.isArray(v) ? v : [v]).map((x) => ({ ...x }));
      let conflict = null;
      const add = () =>
        items.map((item) => {
          if (conflict) {
            const existing = list(name).find((r) => conflict.target.every((c) => r[c.name] === item[c.name]));
            if (existing) return Object.assign(existing, conflict.set ?? {});
          }
          if (!("id" in item) && !["backupEvents", "settings"].includes(name)) item.id = (ids[name] = (ids[name] ?? 0) + 1);
          list(name).push(item);
          return item;
        });
      const done = {
        returning: () => thenable(add),
        onConflictDoUpdate: (c) => ((conflict = { target: [].concat(c.target), set: c.set }), done),
        onConflictDoNothing: () => done,
        ...thenable(add),
      };
      return done;
    },
  };
}
function update(t) {
  return {
    set: (s) => ({
      where: (c) => {
        const run = () => list(t._table).filter((r) => matches(r, c)).map((r) => Object.assign(r, s));
        return { returning: () => thenable(run), ...thenable(run) };
      },
    }),
  };
}
const db = { select, insert, update, delete: () => ({ where: () => thenable(() => {}) }), transaction: async (fn) => fn(db) };

mock.module("../src/db/index.js", { namedExports: { db } });
mock.module("../src/db/schema.js", { namedExports: tables });
mock.module("drizzle-orm", {
  namedExports: {
    eq: (col, val) => (row) => row[col.name] === val,
    and: (...cs) => (row) => cs.every((c) => !c || c(row)),
    inArray: (col, vals) => (row) => vals.includes(row[col.name]),
    ne: (col, val) => (row) => row[col.name] !== val,
    desc: () => null,
    sql: () => null,
    count: () => null,
  },
});
const noop = () => {};
mock.module("express", { namedExports: { Router: () => ({ get: noop, post: noop, use: noop }) } });
mock.module("../src/auth.js", { namedExports: { requireRole: () => noop } });
mock.module("../src/permissions.js", { namedExports: { ADMINS: ["owner", "admin"], STAFF: ["owner", "admin", "agent"] } });
mock.module("../src/validate.js", { namedExports: { BadInput: class extends Error {} } });
mock.module("../src/secrets.js", { namedExports: { seal: (x) => x, unseal: (x) => x } });
mock.module("../src/sla.js", {
  namedExports: { getSla: async () => Object.fromEntries([1, 2, 3, 4].map((p) => [p, { firstResponse: 1, resolve: 8 }])) },
});
const ticketEvents = [];
mock.module("../src/activity.js", { namedExports: { recordEvent: async (e) => ticketEvents.push(e.type) } });
mock.module("../src/automation.js", { namedExports: { afterTicketEvent: async () => {} } });
const notified = [];
mock.module("../src/notify.js", {
  namedExports: { notify: async (people, n) => notified.push(n.title), onTicketCreated: noop },
});
mock.module("../src/live.js", { namedExports: { sendToEveryone: noop } });

const { handleEvent } = await import("../src/backupAlerts.js");

const gateway = { id: "gw1", name: "Main gateway" };
const alertEvent = (over = {}) => ({
  id: Math.floor(Math.random() * 1e9),
  kind: "offsite.failed",
  title: "Off-site copy failed",
  severity: "medium",
  at: new Date().toISOString(),
  deviceId: "dev-1",
  device: "reception-pc",
  client: "Smith Dental",
  recovers: false,
  detail: null,
  ...over,
});
const alertsNow = () => list("alerts");

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  for (const k of Object.keys(ids)) delete ids[k];
  ticketEvents.length = 0;
  notified.length = 0;
  list("users").push({ id: "u1", role: "agent", status: "active" });
});

test("a new problem is an alert, not a ticket; the same problem again is counted on it", async () => {
  assert.equal(await handleEvent([alertEvent()], gateway), "alert");
  assert.equal(await handleEvent([alertEvent(), alertEvent()], gateway), "added");
  assert.equal(alertsNow().length, 1);
  assert.equal(alertsNow()[0].count, 3);
  assert.equal(alertsNow()[0].status, "open");
  assert.equal(list("tickets").length, 0, "no ticket for a medium alert");
  assert.equal(list("customers").length, 1, "a customer was made for the unlinked client");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(notified.length, 0, "medium alerts don't notify");
});

test("getting worse to critical makes a ticket and tells people", async () => {
  await handleEvent([alertEvent()], gateway);
  assert.equal(await handleEvent([alertEvent({ severity: "critical", title: "Off-site copies failing for 3 days" })], gateway), "added");
  const [a] = alertsNow();
  assert.equal(a.severity, "critical");
  assert.equal(list("tickets").length, 1);
  assert.equal(a.ticketId, list("tickets")[0].id);
  assert.equal(list("tickets")[0].priority, 4);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(notified[0], /^Critical alert:/);
  // Again while critical: no second ticket, the ticket gets a note
  await handleEvent([alertEvent({ severity: "critical" })], gateway);
  assert.equal(list("tickets").length, 1);
  assert.ok(list("messages").filter((m) => m.ticketId === a.ticketId).length >= 2);
});

test("a new critical problem: an alert and a ticket straight away", async () => {
  assert.equal(await handleEvent([alertEvent({ kind: "malware.found", title: "Malware found", severity: "critical" })], gateway), "alert and ticket");
  assert.equal(list("tickets").length, 1);
  assert.equal(list("tickets")[0].source, "backup");
});

test("back to normal resolves the alert and its ticket; coming back later is a new alert", async () => {
  await handleEvent([alertEvent({ severity: "critical" })], gateway);
  assert.equal(await handleEvent([alertEvent({ recovers: true, title: "Off-site copy worked" })], gateway), "resolved");
  const [a] = alertsNow();
  assert.equal(a.status, "resolved");
  assert.equal(a.resolvedById, null, "resolved by itself");
  assert.equal(list("tickets")[0].status, "resolved");
  assert.ok(ticketEvents.includes("status:resolved"));
  // Back to normal with nothing open: nothing happens
  assert.equal(await handleEvent([alertEvent({ recovers: true })], gateway), "nothing open");
  // The problem comes back: a new alert
  assert.equal(await handleEvent([alertEvent()], gateway), "alert");
  assert.equal(alertsNow().length, 2);
});

test("different devices and different problems are separate alerts", async () => {
  await handleEvent([alertEvent()], gateway);
  await handleEvent([alertEvent({ deviceId: "dev-2", device: "front-desk" })], gateway);
  await handleEvent([alertEvent({ kind: "device.offline", title: "Stopped checking in" })], gateway);
  assert.equal(alertsNow().length, 3);
});
