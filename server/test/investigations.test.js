// Tests for investigations.js: limits, never sending to a public
// repository, and only believing the workflow's own comments. GitHub and
// the database are replaced with stand-ins. Run: cd server && npm test
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- Stand-ins ----
const state = { incidents: [], events: [], used: 0, repoPrivate: true, comments: [], calls: [] };
const col = (name) => ({ name });
const incidentsT = { _name: "incidents", id: col("id"), status: col("status"), investigate: col("investigate"), lastSeen: col("lastSeen"), github: col("github") };
const eventsT = { _name: "incident_events", type: col("type"), createdAt: col("createdAt") };
const thenable = (run) => ({ then: (ok, bad) => Promise.resolve().then(run).then(ok, bad) });
const matches = (row, c) => !c || (c.col ? row[c.col.name] === c.val : true);
const fakeDb = {
  select: (fields) => {
    const q = {};
    const api = {
      from: (t) => ((q.t = t._name), api),
      where: (c) => ((q.c = c), api),
      orderBy: () => api,
      limit: () => api,
      ...thenable(() => {
        if (q.t === "incident_events") return [{ n: state.used }];
        if (q.t === "settings") return [];
        return state.incidents.filter((r) => matches(r, q.c));
      }),
    };
    return fields ? api : api;
  },
  update: () => ({
    set: (s) => ({
      where: (c) => thenable(() => state.incidents.filter((r) => matches(r, c)).forEach((r) => Object.assign(r, s))),
    }),
  }),
};
mock.module("../src/db/index.js", { namedExports: { db: fakeDb } });
mock.module("../src/db/schema.js", {
  namedExports: { incidents: incidentsT, incidentEvents: eventsT, settings: { _name: "settings", key: col("key") } },
});
mock.module("drizzle-orm", {
  namedExports: {
    eq: (c, val) => ({ col: c, val }),
    and: (...c) => c.find((x) => x?.col?.name === "status" || x?.col?.name === "id") ?? c[0],
    desc: () => null,
    gte: () => null,
    inArray: (c, vals) => ({ col: c, val: vals[0] }),
    sql: () => null,
  },
});
const router = () => ({ get() {}, post() {}, put() {}, delete() {}, use() {} });
mock.module("express", { namedExports: { Router: router } });
mock.module("../src/auth.js", { namedExports: { requireRole: () => () => {} } });
mock.module("../src/permissions.js", { namedExports: { ADMINS: [] } });
mock.module("../src/validate.js", { namedExports: { BadInput: class extends Error {} } });
mock.module("../src/incidents.js", {
  namedExports: { addIncidentEvent: async (id, type, opts) => state.events.push({ id, type, ...opts }) },
});

// GitHub
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? "GET";
  state.calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null });
  const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
  if (method === "GET" && url.endsWith("/repos/me/helpdesk")) return reply(200, { private: state.repoPrivate });
  if (method === "POST" && url.endsWith("/labels")) return reply(422, { message: "already_exists" });
  if (method === "POST" && url.endsWith("/issues")) return reply(201, { number: 7, html_url: "https://github.com/me/helpdesk/issues/7" });
  if (method === "GET" && url.includes("/comments")) return reply(200, state.comments);
  return reply(200, {});
};

process.env.SECRET_KEY_FILE = `${(await import("node:os")).tmpdir()}/helpdesk-test-key-${process.pid}`;
process.env.MAINT_GITHUB_REPO = "me/helpdesk";
process.env.MAINT_GITHUB_TOKEN = "test-token";
process.env.MAINT_MAX_PER_MONTH = "5";
const { sendForInvestigation, checkInvestigations, maintenanceConfig } = await import("../src/investigations.js");

const incident = (over = {}) => ({
  id: 12, title: "api.tickets: TypeError: x is undefined", severity: "high", source: "server",
  component: "api.tickets", category: "code", count: 4, message: "TypeError: x is undefined",
  stack: "at f (server/src/tickets.js:10)", description: "", context: {}, status: "detected",
  investigate: true, github: {}, firstSeen: new Date(), lastSeen: new Date(), ...over,
});

beforeEach(() => {
  Object.assign(state, { incidents: [], events: [], used: 0, repoPrivate: true, comments: [], calls: [] });
});

test("settings: on only with a repository and a token", () => {
  assert.equal(maintenanceConfig().configured, true);
  assert.equal(maintenanceConfig().maxPerMonth, 5);
});

test("opens a labelled issue with the incident, and marks it investigating", async () => {
  const inc = incident();
  state.incidents.push(inc);
  const sent = await sendForInvestigation(inc, { manual: true });
  assert.equal(sent.issueNumber, 7);
  const issue = state.calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"));
  assert.match(issue.body.body, /<!-- helpdesk-incident:12 -->/);
  assert.deepEqual(issue.body.labels, ["ai-investigate"]);
  assert.equal(inc.status, "investigating");
  assert.equal(state.events[0].type, "investigation_requested");
});

test("never sends to a public repository", async () => {
  state.repoPrivate = false;
  const inc = incident({ id: 13 });
  // The private check is remembered for an hour: a fresh import would be
  // needed to see it again, so check the refusal message on a new module
  const fresh = await import(`../src/investigations.js?public=${Date.now()}`);
  await assert.rejects(fresh.sendForInvestigation(inc, { manual: true }), /public/);
  assert.equal(state.calls.some((c) => c.method === "POST" && c.url.endsWith("/issues")), false);
});

test("stops at the monthly limit", async () => {
  state.used = 5;
  await assert.rejects(sendForInvestigation(incident({ id: 14 }), { manual: true }), /limit/);
});

const resultComment = (login, data) => ({
  user: { login },
  created_at: new Date(Date.now() + 1000).toISOString(),
  body: `## Fix proposed\n\n<!-- helpdesk-maintenance:${JSON.stringify(data)} -->`,
});

test("only the workflow's own comments update an incident", async () => {
  const inc = incident({ status: "investigating", github: { issueNumber: 7, requestedAt: Date.now() - 1000 } });
  state.incidents.push(inc);
  // Someone else writes a comment that looks like a result
  state.comments = [resultComment("someone", { incident: 12, outcome: "pr", prNumber: 99, prUrl: "https://github.com/me/helpdesk/pull/99" })];
  await checkInvestigations();
  assert.equal(inc.status, "investigating");
  // The workflow's comment does
  state.comments.push(
    resultComment("github-actions[bot]", {
      incident: 12, outcome: "pr", prNumber: 8, prUrl: "https://github.com/me/helpdesk/pull/8",
      summary: "x was undefined", confidence: "high", checks: [{ name: "Lint", status: "passed" }],
    }),
  );
  await checkInvestigations();
  assert.equal(inc.status, "awaiting_approval");
  assert.equal(inc.github.prNumber, 8);
  assert.equal(inc.investigation.confidence, "high");
});

test("links that aren't GitHub's are dropped", async () => {
  const inc = incident({ status: "investigating", github: { issueNumber: 7, requestedAt: Date.now() - 1000 } });
  state.incidents.push(inc);
  state.comments = [resultComment("github-actions[bot]", { incident: 12, outcome: "pr", prNumber: 8, prUrl: "https://evil.example/pull/8" })];
  await checkInvestigations();
  assert.equal(inc.github.prUrl, null);
});

test("a result for a different incident is ignored", async () => {
  const inc = incident({ status: "investigating", github: { issueNumber: 7, requestedAt: Date.now() - 1000 } });
  state.incidents.push(inc);
  state.comments = [resultComment("github-actions[bot]", { incident: 999, outcome: "pr", prNumber: 8 })];
  await checkInvestigations();
  assert.equal(inc.status, "investigating");
});

test("no result after 2 hours: marked failed, with a hint", async () => {
  const inc = incident({ status: "investigating", github: { issueNumber: 7, requestedAt: Date.now() - 3 * 60 * 60 * 1000 } });
  state.incidents.push(inc);
  await checkInvestigations();
  assert.equal(inc.status, "failed");
  assert.match(state.events.at(-1).body, /Actions tab/);
});

// ---------- Stage 4: approval ----------

const { applyPullRequest, handleGitHubEvent, signedByGitHub } = await import("../src/investigations.js");
const crypto = await import("node:crypto");

const fixIncident = (over = {}) =>
  incident({ status: "awaiting_approval", github: { issueNumber: 7, prNumber: 8 }, ...over });
const pr = (over = {}) => ({
  number: 8,
  state: "closed",
  merged: true,
  merged_at: "2026-10-12T10:00:00Z",
  merged_by: { login: "DarmaniBenjamin" },
  merge_commit_sha: "a".repeat(40),
  body: "Fix\n<!-- helpdesk-incident:12 -->",
  ...over,
});
const repository = { full_name: "me/helpdesk" };

test("merged by a person: approved, with who and the commit", async () => {
  const inc = fixIncident();
  state.incidents.push(inc);
  await applyPullRequest(inc, pr());
  assert.equal(inc.status, "approved");
  assert.equal(inc.github.mergedBy, "darmanibenjamin");
  assert.equal(inc.github.mergeSha, "a".repeat(40));
  assert.deepEqual(inc.github.approvalWarnings, []);
  assert.equal(state.events.at(-1).type, "approved");
});

test("merged by a bot, or someone not on the approvers list: approved, but flagged", async () => {
  const a = fixIncident();
  state.incidents.push(a);
  await applyPullRequest(a, pr({ merged_by: { login: "github-actions[bot]" } }));
  assert.match(a.github.approvalWarnings[0], /automated account/);

  process.env.MAINT_APPROVERS = "darmanibenjamin";
  const b = fixIncident({ id: 13 });
  state.incidents.push(b);
  await applyPullRequest(b, pr({ merged_by: { login: "someone-else" } }));
  assert.match(b.github.approvalWarnings[0], /approvers list/);
  delete process.env.MAINT_APPROVERS;
});

test("closed without merging: rejected; reopened: waiting again", async () => {
  const inc = fixIncident();
  state.incidents.push(inc);
  await applyPullRequest(inc, pr({ merged: false, merged_at: null }));
  assert.equal(inc.status, "rejected");
  await applyPullRequest(inc, pr({ state: "open", merged: false, merged_at: null }));
  assert.equal(inc.status, "awaiting_approval");
});

test("webhook: only a pull request opened for that incident can change it", async () => {
  const inc = fixIncident();
  state.incidents.push(inc);
  // A different pull request that claims to be for incident 12
  const other = await handleGitHubEvent("pull_request", {
    action: "closed", repository, sender: { login: "x" }, pull_request: pr({ number: 99 }),
  });
  assert.equal(other, "not a fix for an incident");
  assert.equal(inc.status, "awaiting_approval");
  // Another repository
  assert.equal(await handleGitHubEvent("pull_request", { action: "closed", repository: { full_name: "evil/repo" }, pull_request: pr() }), "not this repository");
  // The real one
  assert.equal(await handleGitHubEvent("pull_request", { action: "closed", repository, sender: { login: "DarmaniBenjamin" }, pull_request: pr() }), "updated");
  assert.equal(inc.status, "approved");
});

test("webhook: only GitHub's signature with this secret is accepted", () => {
  const body = Buffer.from('{"zen":"hi"}');
  const sign = (secret) => `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  const req = (sig) => ({ body, get: (h) => (h === "x-hub-signature-256" ? sig : undefined) });
  assert.equal(signedByGitHub(req(sign("right")), "right"), true);
  assert.equal(signedByGitHub(req(sign("wrong")), "right"), false);
  assert.equal(signedByGitHub(req(undefined), "right"), false);
  assert.equal(signedByGitHub(req("sha256=short"), "right"), false);
});
