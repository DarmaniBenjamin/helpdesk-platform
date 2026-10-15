// Tests for the Alerts page's rules (alerts.js). The database and the
// rest of the server are replaced with stand-ins. Run: cd server && npm test
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const noop = () => {};
mock.module("express", { namedExports: { Router: () => ({ get: noop, post: noop, use: noop }) } });
mock.module("drizzle-orm", {
  namedExports: { and: noop, desc: noop, eq: noop, inArray: noop, ne: noop, sql: noop },
});
mock.module("../src/db/index.js", { namedExports: { db: {} } });
mock.module("../src/db/schema.js", {
  namedExports: {
    alertEvents: {},
    alerts: {},
    backupClients: {},
    customers: {},
    departments: {},
    messages: {},
    tickets: {},
    userDepartments: {},
    users: {},
  },
});
mock.module("../src/auth.js", { namedExports: { requireRole: () => noop } });
mock.module("../src/permissions.js", { namedExports: { STAFF: ["owner", "admin", "agent"] } });
mock.module("../src/validate.js", { namedExports: { BadInput: class extends Error {} } });
mock.module("../src/sla.js", { namedExports: { getSla: async () => ({}) } });
mock.module("../src/activity.js", { namedExports: { recordEvent: async () => {} } });
mock.module("../src/automation.js", { namedExports: { afterTicketEvent: async () => {} } });
mock.module("../src/notify.js", { namedExports: { notify: async () => {}, onTicketCreated: noop } });
mock.module("../src/live.js", { namedExports: { sendToEveryone: noop } });

const { worse, notifies, makesTicket, isOpen, makeTicket } = await import("../src/alerts.js");

test("the more serious severity wins, in either order", () => {
  assert.equal(worse("medium", "critical"), "critical");
  assert.equal(worse("critical", "low"), "critical");
  assert.equal(worse("high", "medium"), "high");
  assert.equal(worse("info", "low"), "low");
  assert.equal(worse("medium", "medium"), "medium");
});

test("only high and critical alerts notify people", () => {
  assert.deepEqual(
    ["info", "low", "medium", "high", "critical"].map(notifies),
    [false, false, false, true, true],
  );
});

test("only critical alerts make a ticket by themselves", () => {
  assert.deepEqual(
    ["info", "low", "medium", "high", "critical"].map(makesTicket),
    [false, false, false, false, true],
  );
});

test("open and acknowledged alerts are still open; resolved ones aren't", () => {
  assert.equal(isOpen("open"), true);
  assert.equal(isOpen("acknowledged"), true);
  assert.equal(isOpen("resolved"), false);
});

test("an alert with no customer can't make a ticket (there's no one to make it for)", async () => {
  await assert.rejects(
    makeTicket({ id: 1, title: "Backup failed", severity: "critical", customerId: null, ticketId: null }),
    /isn't linked to a customer/,
  );
});
