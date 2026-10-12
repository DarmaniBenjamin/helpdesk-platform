// Tests for incidentRules.js. Run: cd server && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appFrames,
  categorize,
  cleanStack,
  fingerprint,
  normalizeMessage,
  redact,
  triage,
} from "../src/incidentRules.js";

test("redact: takes out passwords, tokens and keys", () => {
  const cases = [
    ["password=hunter2", "hunter2"],
    ['{"token":"abc123secretvalue"}', "abc123secretvalue"],
    ["Authorization: Bearer eyJhbGciOi.abcdefghij.klmnopqrst", "eyJhbGciOi"],
    ["api_key: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV", "sk-ant-api03"],
    ["key ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", "ghp_ABCDEFGHIJ"],
    ["aws AKIAABCDEFGHIJKLMNOP here", "AKIAABCDEFGHIJKLMNOP"],
    ["postgres://helpdesk:s3cretpass@localhost:5432/db", "s3cretpass"],
    ["/api/phone/hook/9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c0e2f4a6b8c0d2e4f", "9f2c4e6a8b0d"],
    ["cookie=sid%3Dabcdef123456", "abcdef123456"],
  ];
  for (const [input, secret] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `"${secret}" still in "${out}"`);
  }
});

test("redact: takes out email addresses and phone numbers", () => {
  const out = redact("Couldn't email keisha.charles@example.com or call +1 473-555-1234");
  assert.ok(!out.includes("keisha"));
  assert.ok(!out.includes("555-1234"));
  assert.match(out, /\[email\]/);
  assert.match(out, /\[number\]/);
});

test("redact: leaves ordinary error messages readable", () => {
  const msg = "Cannot read properties of undefined (reading 'status')";
  assert.equal(redact(msg), msg);
  assert.equal(redact('relation "tickets" does not exist'), 'relation "tickets" does not exist');
});

test("redact: cuts long text and removes control characters", () => {
  assert.equal(redact("x".repeat(50), 10), `${"x".repeat(10)}…`);
  assert.equal(redact("a\u0000b\u001bc"), "abc");
});

const STACK = `TypeError: Cannot read properties of undefined (reading 'id')
    at ticketRoute (/opt/helpdesk-platform/server/src/tickets.js:612:9)
    at Layer.handle (/opt/helpdesk-platform/server/node_modules/express/lib/router/layer.js:95:5)
    at async loadSession (/opt/helpdesk-platform/server/src/auth.js:140:3)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`;

test("appFrames: keeps only the app's own files, with short paths", () => {
  assert.deepEqual(appFrames(STACK), [
    "ticketRoute (server/src/tickets.js:612)",
    "async loadSession (server/src/auth.js:140)",
  ]);
});

test("cleanStack: no absolute paths or library frames", () => {
  const out = cleanStack(STACK);
  assert.ok(!out.includes("/opt/"));
  assert.ok(!out.includes("node_modules"));
  assert.match(out, /server\/src\/tickets\.js:612/);
});

test("fingerprint: the same error with different values groups together", () => {
  const a = fingerprint({ component: "api", category: "code", message: "Ticket 12 not found for 'abc'", stack: STACK });
  const b = fingerprint({ component: "api", category: "code", message: "Ticket 99 not found for 'xyz'", stack: STACK });
  assert.equal(a, b);
});

test("fingerprint: line numbers moving (after an edit) don't make a new incident", () => {
  const moved = STACK.replace("tickets.js:612:9", "tickets.js:640:9");
  assert.equal(
    fingerprint({ component: "api", category: "code", message: "x", stack: STACK }),
    fingerprint({ component: "api", category: "code", message: "x", stack: moved }),
  );
});

test("fingerprint: different errors get different fingerprints", () => {
  const a = fingerprint({ component: "api", category: "code", message: "x is undefined", stack: STACK });
  const b = fingerprint({ component: "api", category: "code", message: "y is undefined", stack: STACK });
  const c = fingerprint({ component: "email", category: "code", message: "x is undefined", stack: STACK });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("normalizeMessage: numbers, IDs and quoted values are taken out", () => {
  assert.equal(
    normalizeMessage("Ticket 42 for user 'bob' (id 1b4e28ba-2fa1-11d2-883f-0016d3cca427)"),
    "ticket <n> for user <value> (id <id>)",
  );
});

test("categorize", () => {
  assert.equal(categorize({ code: "23505", severity: "ERROR", message: "duplicate key" }), "database");
  assert.equal(categorize({ code: "ECONNREFUSED", message: "connect" }), "network");
  assert.equal(categorize(new TypeError("x is undefined")), "code");
  assert.equal(categorize(new SyntaxError("Unexpected token in JSON")), "bad-input");
  assert.equal(categorize(new Error("something")), "runtime");
});

test("triage: what's worth an AI investigation", () => {
  assert.equal(triage({ source: "user", category: "runtime", count: 1 }).investigate, true);
  assert.equal(triage({ source: "crash", category: "code", count: 1 }).investigate, true);
  assert.equal(triage({ source: "server", category: "network", count: 50 }).investigate, false);
  assert.equal(triage({ source: "server", category: "code", count: 1 }).investigate, false);
  assert.equal(triage({ source: "server", category: "code", count: 2 }).investigate, true);
  assert.equal(triage({ source: "browser", category: "code", count: 4 }).investigate, false);
  assert.equal(triage({ source: "browser", category: "code", count: 5 }).investigate, true);
  assert.equal(triage({ source: "server", category: "runtime", count: 3 }).investigate, true);
});

test("triage: severity", () => {
  assert.equal(triage({ source: "crash", category: "code" }).severity, "critical");
  assert.equal(triage({ source: "server", component: "health", category: "database" }).severity, "critical");
  assert.equal(triage({ source: "server", category: "database" }).severity, "high");
  assert.equal(triage({ source: "server", category: "network" }).severity, "low");
});
