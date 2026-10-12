// Tests for the rules every AI-proposed change has to pass
// (scripts/maintenance/policy.mjs). Run: cd server && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEdits,
  checkPath,
  diffPaths,
  parseModelJson,
  stackFiles,
  validatePlan,
} from "../../scripts/maintenance/policy.mjs";

test("checkPath: the app's own code and tests can be changed", () => {
  for (const p of ["server/src/tickets.js", "src/Components/Pages/Inbox.jsx", "server/test/tickets.test.js", "src/index.css"])
    assert.equal(checkPath(p).ok, true, p);
});

test("checkPath: workflows, deploy, packages, migrations, secrets and .env never", () => {
  for (const p of [
    ".github/workflows/ai-investigate.yml",
    "deploy/install.sh",
    "scripts/maintenance/policy.mjs",
    "server/.env",
    "package.json",
    "server/package-lock.json",
    "server/drizzle/0015_x.sql",
    "server/src/secrets.js",
    "server/node_modules/express/index.js",
    "README.md",
    "server/test/helper.js",
  ])
    assert.equal(checkPath(p).ok, false, p);
});

test("checkPath: tricks with paths don't work", () => {
  for (const p of ["/etc/passwd", "../outside.js", "server/src/../../.github/x.js", "server\\src\\x.js", "", null])
    assert.equal(checkPath(p).ok, false, String(p));
});

test("checkPath: sign-in, permissions and backup files are marked sensitive", () => {
  assert.equal(checkPath("server/src/auth.js").sensitive, true);
  assert.equal(checkPath("server/src/permissions.js").sensitive, true);
  assert.equal(checkPath("server/src/backup.js").sensitive, true);
  assert.equal(checkPath("server/src/tickets.js").sensitive, false);
});

test("parseModelJson: finds the JSON in fences or around words", () => {
  assert.deepEqual(parseModelJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.equal(parseModelJson("no json here"), null);
  assert.equal(parseModelJson("{broken"), null);
});

test("validatePlan: refuses edits to forbidden files, keeps the rest", () => {
  const { plan, errors } = validatePlan({
    canFix: true,
    confidence: "high",
    edits: [
      { path: "server/src/tickets.js", find: "a", replace: "b" },
      { path: ".github/workflows/x.yml", create: "steal: secrets" },
      { path: "package.json", find: "x", replace: "y" },
    ],
  });
  assert.equal(plan.edits.length, 1);
  assert.equal(errors.length, 2);
});

test("validatePlan: changes touching permissions or deletion are sensitive", () => {
  const a = validatePlan({ canFix: true, edits: [{ path: "server/src/tickets.js", find: "x", replace: "requireRole(...STAFF)" }] });
  assert.equal(a.sensitive, true);
  const b = validatePlan({ canFix: true, edits: [{ path: "server/src/tickets.js", find: "x", replace: "await db.delete(tickets)" }] });
  assert.equal(b.sensitive, true);
  const c = validatePlan({ canFix: true, edits: [{ path: "server/src/tickets.js", find: "x", replace: "const y = 1;" }] });
  assert.equal(c.sensitive, false);
});

test("validatePlan: an unknown confidence is treated as low, and junk is refused", () => {
  assert.equal(validatePlan({ confidence: "certain!!" }).plan.confidence, "low");
  assert.equal(validatePlan(null).plan, null);
  assert.equal(validatePlan({ edits: Array(20).fill({ path: "src/a.js", find: "a", replace: "b" }) }).errors.length > 0, true);
  assert.ok(validatePlan({ canFix: true, edits: [] }).errors.length);
});

test("applyEdits: find must match exactly once", () => {
  const files = { "server/src/a.js": "const x = 1;\nconst y = 2;\nconst x2 = 1;\n" };
  const read = (p) => files[p] ?? null;
  const out = applyEdits(read, [{ path: "server/src/a.js", find: "const y = 2;", replace: "const y = 3;" }]);
  assert.match(out.get("server/src/a.js"), /const y = 3;/);
  assert.throws(() => applyEdits(read, [{ path: "server/src/a.js", find: "nope", replace: "x" }]), /isn't in the file/);
  assert.throws(() => applyEdits(read, [{ path: "server/src/a.js", find: "= 1;", replace: "x" }]), /2 times/);
  assert.throws(() => applyEdits(read, [{ path: "server/src/missing.js", find: "a", replace: "b" }]), /doesn't exist/);
});

test("applyEdits: create only makes new files; $ in replacements is kept as written", () => {
  const read = (p) => (p === "server/src/a.js" ? "let s = 'x';" : null);
  const out = applyEdits(read, [
    { path: "server/test/a.test.js", create: "test" },
    { path: "server/src/a.js", find: "'x'", replace: "'$&$1'" },
  ]);
  assert.equal(out.get("server/test/a.test.js"), "test");
  assert.equal(out.get("server/src/a.js"), "let s = '$&$1';");
  assert.throws(() => applyEdits(read, [{ path: "server/src/a.js", create: "x" }]), /already exists/);
});

test("stackFiles and diffPaths", () => {
  assert.deepEqual(stackFiles("at f (server/src/tickets.js:10)\n at g (src/Components/Inbox.jsx:3)"), [
    "server/src/tickets.js",
    "src/Components/Inbox.jsx",
  ]);
  assert.deepEqual(diffPaths("diff --git a/server/src/a.js b/server/src/a.js\n+x"), ["server/src/a.js"]);
});

test("lowRisk: only small, confident, fully checked, non-sensitive fixes", async () => {
  const { lowRisk } = await import("../../scripts/maintenance/policy.mjs");
  const plan = { confidence: "high", attempt: 1, edits: [{ path: "server/src/tickets.js", find: "a", replace: "b" }] };
  const ok = { plan, passed: true, touched: ["server/src/tickets.js", "server/test/t.test.js"], sensitive: false };
  assert.equal(lowRisk(ok).ok, true);
  assert.equal(lowRisk({ ...ok, sensitive: true }).ok, false);
  assert.equal(lowRisk({ ...ok, passed: false }).ok, false);
  assert.equal(lowRisk({ ...ok, plan: { ...plan, confidence: "medium" } }).ok, false);
  assert.equal(lowRisk({ ...ok, plan: { ...plan, attempt: 2 } }).ok, false);
  assert.equal(lowRisk({ ...ok, touched: ["server/src/auth.js"] }).ok, false);
  assert.equal(lowRisk({ ...ok, touched: ["src/a.js", "src/b.js", "src/c.js", "src/d.js"] }).ok, false);
  assert.equal(lowRisk({ ...ok, plan: { ...plan, edits: [{ path: "src/a.js", create: "x\n".repeat(80) }] } }).ok, false);
});
