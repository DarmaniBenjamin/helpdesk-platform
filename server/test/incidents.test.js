// Tests for incidents.js: grouping, limits, redaction, and what happens
// when the database is down. The database, Express and Drizzle are
// replaced with small stand-ins, so this runs without Postgres.
// Run: cd server && npm test
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- Stand-ins ----
const store = { incidents: [], incident_events: [] };
let dbDown = false;
const col = (table, name) => ({ table, name });
const table = (name, cols) =>
  Object.fromEntries([["_name", name], ...cols.map((c) => [c, col(name, c)])]);
const incidentsT = table("incidents", ["id", "fingerprint", "status", "lastSeen"]);
const eventsT = table("incident_events", ["id", "incidentId", "createdAt"]);

const matches = (row, cond) => !cond || row[cond.col.name] === cond.val;
function thenable(run) {
  return { then: (ok, bad) => Promise.resolve().then(run).then(ok, bad) };
}
const fakeDb = {
  select: () => {
    const q = {};
    const api = {
      from: (t) => ((q.t = t._name), api),
      leftJoin: () => api,
      where: (c) => ((q.c = c), api),
      orderBy: () => api,
      limit: () => api,
      ...thenable(() => {
        if (dbDown) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        return store[q.t].filter((r) => matches(r, q.c));
      }),
    };
    return api;
  },
  insert: (t) => ({
    values: (v) => {
      const add = () => {
        if (dbDown) throw new Error("connect ECONNREFUSED");
        const row = { id: store[t._name].length + 1, status: "detected", ...v };
        store[t._name].push(row);
        return [{ id: row.id }];
      };
      return {
        onConflictDoNothing: () => ({ returning: () => thenable(add) }),
        returning: () => thenable(add),
        ...thenable(add),
      };
    },
  }),
  update: (t) => ({
    set: (s) => ({
      where: (c) =>
        thenable(() => {
          if (dbDown) throw new Error("connect ECONNREFUSED");
          store[t._name].filter((r) => matches(r, c)).forEach((r) => Object.assign(r, s));
        }),
    }),
  }),
};

mock.module("../src/db/index.js", {
  namedExports: { db: fakeDb, pool: { query: async () => ({}) } },
});
mock.module("../src/db/schema.js", {
  namedExports: { incidents: incidentsT, incidentEvents: eventsT, users: table("users", ["id", "name"]) },
});
mock.module("drizzle-orm", {
  namedExports: {
    eq: (c, val) => ({ col: c, val }),
    and: (c) => c,
    desc: () => null,
    notInArray: () => undefined,
  },
});
const router = () => ({ get() {}, post() {}, use() {} });
mock.module("express", { namedExports: { Router: router }, defaultExport: { Router: router } });
mock.module("../src/auth.js", {
  namedExports: { requireAuth: () => {}, requireRole: () => () => {} },
});
mock.module("../src/permissions.js", { namedExports: { ADMINS: [], STAFF: [] } });
mock.module("../src/validate.js", { namedExports: { BadInput: class extends Error {} } });

// Quiet: incidents.js logs a JSON line per error
const realError = console.error;
console.error = () => {};
const { capture, flushIncidents } = await import("../src/incidents.js");
console.error = realError;

const STACK = `TypeError: x is undefined
    at handler (/opt/helpdesk-platform/server/src/tickets.js:10:5)`;
const boom = (message = "x is undefined") =>
  Object.assign(new TypeError(message), { stack: STACK.replace("x is undefined", message) });

beforeEach(() => {
  store.incidents.length = 0;
  store.incident_events.length = 0;
  dbDown = false;
});

test("the same error 100 times is one incident with a count of 100", async () => {
  for (let i = 0; i < 100; i++) capture(boom(`ticket ${i} is undefined`), { quiet: true });
  await flushIncidents();
  assert.equal(store.incidents.length, 1);
  assert.equal(store.incidents[0].count, 100);
  assert.equal(store.incidents[0].component, "tickets");
  assert.equal(store.incident_events[0].type, "detected");
});

test("repeats after saving are added to the same incident", async () => {
  capture(boom("y is undefined"), { quiet: true });
  await flushIncidents();
  capture(boom("y is undefined"), { quiet: true });
  capture(boom("y is undefined"), { quiet: true });
  await flushIncidents();
  assert.equal(store.incidents.length, 1);
  assert.equal(store.incidents[0].count, 3);
  // A code error that happened more than once is worth investigating
  assert.equal(store.incidents[0].investigate, true);
});

test("secrets and personal details are never stored", async () => {
  capture(
    boom("login failed for bob@example.com with password=hunter2 token=abcdefghijklmnopqrstuvwxyz0123456789ABCD"),
    { quiet: true, context: { route: "/api/phone/hook/9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c0e2f4a6b8c0d2e4f" } },
  );
  await flushIncidents();
  const saved = JSON.stringify(store.incidents);
  for (const secret of ["bob@example.com", "hunter2", "abcdefghijklmnop", "9f2c4e6a8b0d"])
    assert.ok(!saved.includes(secret), `${secret} was stored`);
});

test("while the database is down, errors wait and are saved when it's back", async () => {
  dbDown = true;
  capture(boom("z is undefined"), { quiet: true });
  await flushIncidents(); // fails quietly, keeps it
  assert.equal(store.incidents.length, 0);
  dbDown = false;
  await flushIncidents();
  assert.equal(store.incidents.length, 1);
});

test("an error that comes back after it was fixed reopens the incident", async () => {
  capture(boom("w is undefined"), { quiet: true });
  await flushIncidents();
  store.incidents[0].status = "verified";
  capture(boom("w is undefined"), { quiet: true });
  await flushIncidents();
  assert.equal(store.incidents[0].status, "detected");
  assert.ok(store.incident_events.some((e) => e.type === "recurred"));
});

test("capture never throws, whatever it's given", () => {
  const circular = {};
  circular.self = circular;
  for (const odd of [null, undefined, "a string", 42, circular, Object.freeze(new Error("frozen"))])
    assert.doesNotThrow(() => capture(odd, { quiet: true }));
});

// Last, because it uses up the hour's limit of new incidents
test("an error loop can't make more than 30 new incidents an hour", async () => {
  for (let i = 0; i < 40; i++)
    capture(
      Object.assign(new Error(`distinct${"x".repeat(i)}`), {
        stack: `Error\n    at f${i} (/srv/server/src/loop${i}.js:1:1)`,
      }),
      { quiet: true },
    );
  await flushIncidents();
  // Earlier tests in this file already used some of the hour's 30
  assert.ok(store.incidents.length <= 30, `made ${store.incidents.length}`);
  assert.ok(store.incidents.length >= 25);
});

test("a deployed fix is verified after 7 days without the error, not before", async () => {
  const { verifyFixes } = await import("../src/incidents.js");
  const day = 24 * 60 * 60 * 1000;
  const deployedAt = new Date(Date.now() - 8 * day).toISOString();
  store.incidents.push(
    { id: 1, status: "deployed", source: "server", lastSeen: new Date(Date.now() - 9 * day), github: { deployedAt } },
    { id: 2, status: "deployed", source: "server", lastSeen: new Date(Date.now() - 1 * day), github: { deployedAt } },
    { id: 3, status: "deployed", source: "server", lastSeen: new Date(Date.now() - 9 * day), github: { deployedAt: new Date().toISOString() } },
  );
  await verifyFixes();
  assert.equal(store.incidents[0].status, "verified"); // quiet for 8 days
  assert.equal(store.incidents[1].status, "deployed"); // happened after the deploy
  assert.equal(store.incidents[2].status, "deployed"); // deployed today
  assert.ok(store.incident_events.some((e) => e.type === "verified" && e.incidentId === 1));
});
