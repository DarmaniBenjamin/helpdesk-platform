// Tests for maintenanceSettings.js (Maintenance → AI & GitHub): the GitHub
// App's sign-in, the AI keys being encrypted before they leave, and
// "Continue with ChatGPT". The database, GitHub, OpenAI and the encryption
// library are replaced with stand-ins. Run: cd server && npm test
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";

process.env.SECRET_KEY_FILE = `${os.tmpdir()}/helpdesk-test-key-settings-${process.pid}`;
delete process.env.MAINT_GITHUB_REPO;
delete process.env.MAINT_GITHUB_TOKEN;

// ---- Stand-ins ----
let stored = null; // the settings row's value
const thenable = (run) => ({ then: (ok, bad) => Promise.resolve().then(run).then(ok, bad) });
const fakeDb = {
  select: () => ({ from: () => ({ where: () => thenable(() => (stored ? [{ key: "maintenance", value: stored }] : [])) }) }),
  insert: () => ({ values: (v) => ({ onConflictDoUpdate: () => thenable(() => (stored = structuredClone(v.value))) }) }),
};
mock.module("../src/db/index.js", { namedExports: { db: fakeDb } });
mock.module("../src/db/schema.js", { namedExports: { settings: { key: "key" } } });
mock.module("drizzle-orm", { namedExports: { eq: () => null } });
const routes = {};
const router = () => {
  const r = { use() {}, get: (p, ...h) => (routes[`GET ${p}`] = h.at(-1)), post() {}, put() {}, delete() {} };
  return r;
};
mock.module("express", { namedExports: { Router: router } });
mock.module("../src/auth.js", { namedExports: { requireRole: () => () => {} } });
mock.module("../src/validate.js", { namedExports: { BadInput: class extends Error {} } });
const sealed = [];
mock.module("libsodium-wrappers", {
  defaultExport: {
    ready: Promise.resolve(),
    base64_variants: { ORIGINAL: 1 },
    from_string: (s) => Buffer.from(s),
    from_base64: (s) => Buffer.from(s, "base64"),
    crypto_box_seal: (message, key) => {
      sealed.push({ message: Buffer.from(message).toString(), key: Buffer.from(key).toString("base64") });
      return Buffer.from("SEALED");
    },
    to_base64: (b) => Buffer.from(b).toString("base64"),
  },
});

const calls = [];
let reply = () => ({});
globalThis.fetch = async (url, opts = {}) => {
  const body = typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body ? Object.fromEntries(opts.body) : null;
  calls.push({ method: opts.method ?? "GET", url: String(url), body, auth: opts.headers?.authorization });
  const { status = 200, data = {} } = reply(String(url), opts.method ?? "GET", body) ?? {};
  return { ok: status < 300, status, json: async () => data };
};

const s = await import("../src/maintenanceSettings.js");
const { seal } = await import("../src/secrets.js");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" });

beforeEach(async () => {
  stored = null;
  calls.length = 0;
  sealed.length = 0;
  reply = () => ({});
  await s.refreshConfig();
});

test("without saved settings or .env lines, nothing is set up", () => {
  const c = s.maintenanceConfig();
  assert.equal(c.configured, false);
  assert.equal(c.source, "env");
});

test("the GitHub App proves who it is with a correctly signed token", () => {
  const jwt = s.appJwt({ id: 123, privateKey: seal(pem) }, 1_800_000_000_000);
  const [head, payload, signature] = jwt.split(".");
  const ok = crypto.createVerify("RSA-SHA256").update(`${head}.${payload}`).verify(publicKey, signature, "base64url");
  assert.equal(ok, true);
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "123");
  assert.ok(claims.exp - claims.iat <= 600, "GitHub allows at most 10 minutes");
});

test("the app asks for only what's needed, and a name GitHub accepts", () => {
  const m = s.appManifest("https://help.example.com", "me/helpdesk");
  assert.deepEqual(m.default_permissions, {
    issues: "write",
    pull_requests: "read",
    checks: "read",
    secrets: "write",
    metadata: "read",
  });
  assert.equal(m.public, false);
  assert.ok(m.name.length <= 34);
  assert.equal(m.hook_attributes.url, "https://help.example.com/api/maintenance/github-webhook");
  assert.equal(m.redirect_url, "https://help.example.com/api/maintenance/github/created");
});

test("connected as the app: GitHub's API is used with the app's short-lived token", async () => {
  stored = { repo: "me/helpdesk", auth: "app", app: { id: 1, privateKey: seal(pem), installationId: 9, webhookSecret: seal("hook") } };
  await s.refreshConfig();
  reply = (url) =>
    url.endsWith("/app/installations/9/access_tokens")
      ? { data: { token: "ghs_install", expires_at: new Date(Date.now() + 3600e3).toISOString() } }
      : {};
  assert.equal(s.maintenanceConfig().configured, true);
  assert.equal(s.maintenanceConfig().webhookSecret, "hook");
  assert.equal(await s.githubToken(), "ghs_install");
  assert.equal(await s.githubToken(), "ghs_install");
  assert.equal(calls.filter((c) => c.url.endsWith("/access_tokens")).length, 1, "the token is reused, not made every time");
});

test("an AI key is encrypted with the repository's key before it goes to GitHub", async () => {
  stored = { repo: "me/helpdesk", auth: "token", token: seal("ghp_test_token_1234567890") };
  await s.refreshConfig();
  reply = (url) => (url.endsWith("/actions/secrets/public-key") ? { data: { key: Buffer.from("PUBKEY").toString("base64"), key_id: "k1" } } : {});
  await s.putSecret("ANTHROPIC_API_KEY", "sk-ant-secret-value");
  assert.deepEqual(sealed, [{ message: "sk-ant-secret-value", key: Buffer.from("PUBKEY").toString("base64") }]);
  const put = calls.find((c) => c.method === "PUT");
  assert.match(put.url, /\/repos\/me\/helpdesk\/actions\/secrets\/ANTHROPIC_API_KEY$/);
  assert.equal(put.body.key_id, "k1");
  assert.ok(!JSON.stringify(calls).includes("sk-ant-secret-value"), "the key itself is never sent");
});

test("the chosen AI goes with each investigation", async () => {
  stored = { repo: "me/helpdesk", auth: "token", token: seal("ghp_test_token_1234567890"), provider: "gemini", model: "" };
  await s.refreshConfig();
  assert.deepEqual(await s.prepareAiForInvestigation(), { provider: "gemini", model: "gemini-2.5-flash", auth: "key" });
});

test("Continue with ChatGPT: a fresh access token is stored before an investigation", async () => {
  stored = {
    repo: "me/helpdesk",
    auth: "token",
    token: seal("ghp_test_token_1234567890"),
    provider: "openai",
    openaiMode: "signin",
    openai: { clientId: "oaiapp_x", tokens: seal(JSON.stringify({ access: "old", refresh: "r1", expires: Date.now() + 60_000 })) },
  };
  await s.refreshConfig();
  reply = (url) => {
    if (url.includes("auth.openai.com")) return { data: { access_token: "fresh", refresh_token: "r2", expires_in: 3600, scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct" } };
    if (url.endsWith("/public-key")) return { data: { key: Buffer.from("PUBKEY").toString("base64"), key_id: "k1" } };
    return {};
  };
  const ai = await s.prepareAiForInvestigation();
  assert.equal(ai.auth, "signin");
  const refresh = calls.find((c) => c.url.includes("auth.openai.com"));
  assert.equal(refresh.body.grant_type, "refresh_token");
  assert.equal(refresh.body.refresh_token, "r1");
  assert.equal(refresh.body.resource, "https://api.openai.com/v1");
  assert.deepEqual(sealed.map((x) => x.message), ["fresh"]);
  assert.ok(calls.some((c) => c.method === "PUT" && c.url.endsWith("/OPENAI_OAUTH_TOKEN")));
});

test("Continue with ChatGPT: a sign-in without plan usage is refused", async () => {
  stored = {
    repo: "me/helpdesk",
    auth: "token",
    token: seal("ghp_test_token_1234567890"),
    openai: { clientId: "oaiapp_x", tokens: seal(JSON.stringify({ access: "old", refresh: "r1", expires: 0 })) },
  };
  await s.refreshConfig();
  reply = () => ({ data: { access_token: "a", refresh_token: "r2", expires_in: 3600, scope: "openid profile email" } });
  await assert.rejects(s.openaiAccessToken(), /didn't allow using the ChatGPT plan/);
});

test("Continue with ChatGPT: the sign-in link uses PKCE and the right resource", () => {
  stored = { openai: { clientId: "oaiapp_x" } };
  return s.refreshConfig().then(() => {
    let location = "";
    const req = { user: { id: "u1" }, protocol: "https", get: () => "help.example.com" };
    routes["GET /openai/signin"](req, { redirect: (url) => (location = url) });
    const url = new URL(location);
    assert.equal(url.origin + url.pathname, "https://auth.openai.com/api/accounts/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("resource"), "https://api.openai.com/v1");
    assert.equal(url.searchParams.get("redirect_uri"), "https://help.example.com/api/maintenance/openai/callback");
    assert.match(url.searchParams.get("scope"), /chatgpt\.tokens\.use\.direct/);
  });
});

test("a sign-in link works once, and only for the person who started it", async () => {
  stored = { openai: { clientId: "oaiapp_x" } };
  await s.refreshConfig();
  let location = "";
  routes["GET /openai/signin"]({ user: { id: "u1" }, protocol: "https", get: () => "h" }, { redirect: (u) => (location = u) });
  const state = new URL(location).searchParams.get("state");
  reply = () => ({ data: { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "chatgpt.tokens.use.direct" } });
  const go = async (userId) => {
    let to = "";
    await routes["GET /openai/callback"]({ user: { id: userId }, query: { state, code: "c" }, protocol: "https", get: () => "h" }, { redirect: (u) => (to = u) });
    return to;
  };
  assert.match(await go("someone-else"), /error=/);
  // The state was used up by that attempt too
  assert.match(await go("u1"), /error=/);
});
