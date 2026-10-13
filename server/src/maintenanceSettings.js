// Maintenance → AI & GitHub (Super Admin): everything the AI
// investigations need, set from the helpdesk's screens. Nothing in .env.
// Saved in the database (secrets locked with secrets.js), so it comes back
// with a restore too.
//
//   GitHub: "Connect GitHub" makes a GitHub App for this helpdesk, from a
//     manifest (GitHub's own one-click flow): the person clicks Create on
//     GitHub, then picks the repository to install it on. The app has
//     only the permissions the maintenance system needs, on that one
//     repository, and its webhook is set up by itself. (A token can be
//     pasted instead, under Advanced.)
//   The AI: Free (GitHub Models), Claude, ChatGPT or Gemini. A key is
//     stored on GitHub as an encrypted Actions secret (the AI runs there,
//     never on this server), and only "set / not set" is shown after.
//     ChatGPT can also be "Continue with ChatGPT" (a Plus or Pro plan),
//     once OpenAI has given this helpdesk an OAuth client.
//
// Older setups with MAINT_GITHUB_* in server/.env still work: those are
// used until something is saved here.
//
//   GET    /api/maintenance/settings                 everything, secrets as set/not set
//   PUT    /api/maintenance/settings                 { provider, model, auto, maxPerDay, ... }
//   POST   /api/maintenance/settings/github/start    { repo } → the form that goes to GitHub
//   POST   /api/maintenance/settings/github/token    { repo, token } (Advanced)
//   POST   /api/maintenance/settings/github/test     what works and what's missing
//   DELETE /api/maintenance/settings/github          disconnect
//   PUT    /api/maintenance/settings/key             { provider, key } → a GitHub secret
//   DELETE /api/maintenance/settings/key/:provider
//   PUT    /api/maintenance/settings/openai-client   { clientId, clientSecret }
//   DELETE /api/maintenance/settings/openai          sign out of ChatGPT
//   GET    /api/maintenance/github/created           GitHub sends the person back here
//   GET    /api/maintenance/github/installed         ...and here after installing
//   GET    /api/maintenance/openai/signin            Continue with ChatGPT
//   GET    /api/maintenance/openai/callback          OpenAI sends the person back here
import crypto from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { BadInput } from "./validate.js";
import { seal, unseal } from "./secrets.js";

export const maintenanceSettingsRouter = Router();
export const maintenanceCallbacksRouter = Router();

const KEY = "maintenance";
const API = "https://api.github.com";
const MINUTE = 60 * 1000;

// The AIs to choose from. secret: the GitHub Actions secret its key is
// stored in (the investigation workflow reads it).
export const PROVIDERS = {
  github: {
    label: "Free (GitHub Models)",
    secret: null,
    model: "openai/gpt-4.1",
  },
  anthropic: {
    label: "Claude",
    secret: "ANTHROPIC_API_KEY",
    model: "claude-sonnet-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    label: "ChatGPT",
    secret: "OPENAI_API_KEY",
    model: "gpt-5",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    label: "Gemini",
    secret: "GEMINI_API_KEY",
    model: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
  },
};
// "Continue with ChatGPT": a fresh access token goes here before each
// investigation (it lasts an hour)
export const OPENAI_SIGNIN_SECRET = "OPENAI_OAUTH_TOKEN";
const OPENAI_AUTH = "https://auth.openai.com/api/accounts/authorize";
const OPENAI_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
const OPENAI_RESOURCE = "https://api.openai.com/v1";
const OPENAI_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const DEFAULTS = {
  repo: "",
  auth: null, // "app" or "token"
  app: null, // { id, slug, htmlUrl, privateKey*, webhookSecret*, installationId }
  token: null, // * (Advanced)
  provider: "github",
  model: "",
  openaiMode: "key", // "key" or "signin"
  openai: null, // { clientId, clientSecret*, tokens*, email, signedInAt }
  auto: true,
  maxPerDay: 3,
  maxPerMonth: 20,
  allowPublic: false,
  approvers: [],
};
// * locked with secrets.js

// ---------- Saved settings ----------

let saved = null;

export async function refreshConfig() {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  saved = row ? { ...DEFAULTS, ...row.value } : null;
  return saved;
}

async function save(changes) {
  const value = { ...DEFAULTS, ...(saved ?? {}), ...changes };
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  saved = value;
  return value;
}

export const open = (sealed) => {
  if (!sealed) return null;
  try {
    return unseal(sealed);
  } catch {
    return null; // locked with a key this server doesn't have any more
  }
};

const envNumber = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// The settings in use: the ones saved here, or (until something is saved)
// the older MAINT_* lines in server/.env
export function maintenanceConfig() {
  if (saved?.repo) {
    const s = saved;
    return {
      source: "settings",
      repo: s.repo,
      configured: Boolean(
        (s.auth === "app" && s.app?.installationId) || (s.auth === "token" && open(s.token)),
      ),
      auth: s.auth,
      auto: s.auto !== false,
      maxPerDay: Number(s.maxPerDay) || 0,
      maxPerMonth: Number(s.maxPerMonth) || 0,
      allowPublic: Boolean(s.allowPublic),
      webhookSecret: open(s.app?.webhookSecret) ?? "",
      approvers: (s.approvers ?? []).map((a) => String(a).toLowerCase()),
      provider: PROVIDERS[s.provider] ? s.provider : "github",
      model: s.model || "",
      openaiMode: s.openaiMode === "signin" ? "signin" : "key",
    };
  }
  const repo = String(process.env.MAINT_GITHUB_REPO ?? "").trim();
  return {
    source: "env",
    repo,
    configured: /^[\w.-]+\/[\w.-]+$/.test(repo) && Boolean(process.env.MAINT_GITHUB_TOKEN),
    auth: "token",
    auto: !/^(off|no|false|0)$/i.test(process.env.MAINT_AUTO_INVESTIGATE ?? "on"),
    maxPerDay: envNumber("MAINT_MAX_PER_DAY", 3),
    maxPerMonth: envNumber("MAINT_MAX_PER_MONTH", 20),
    allowPublic: /^(yes|true|1)$/i.test(process.env.MAINT_ALLOW_PUBLIC_REPO ?? ""),
    webhookSecret: process.env.MAINT_GITHUB_WEBHOOK_SECRET ?? "",
    approvers: String(process.env.MAINT_APPROVERS ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
    provider: "github",
    model: "",
    openaiMode: "key",
  };
}

// ---------- Talking to GitHub as the app ----------

// The app proves who it is with a short JWT signed with its private key
export function appJwt(app, now = Date.now()) {
  const sec = Math.floor(now / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: sec - 60, exp: sec + 540, iss: String(app.id) })}`;
  const signature = crypto.createSign("RSA-SHA256").update(data).sign(open(app.privateKey), "base64url");
  return `${data}.${signature}`;
}

async function call(method, url, { token, body, jwt } = {}) {
  let res;
  try {
    res = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(token || jwt ? { authorization: `Bearer ${token ?? jwt}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BadInput("Couldn't reach GitHub. Try again in a minute.");
  }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new BadInput(`GitHub said: ${data.message ?? res.status}`);
    err.githubStatus = res.status;
    throw err;
  }
  return data;
}

// The app's access token for the repository (an hour; renewed as needed)
let appToken = null;
async function installationToken(app) {
  if (appToken && appToken.installationId === app.installationId && appToken.expires - Date.now() > 5 * MINUTE)
    return appToken.token;
  const data = await call("POST", `/app/installations/${app.installationId}/access_tokens`, {
    jwt: appJwt(app),
  });
  appToken = { token: data.token, expires: Date.parse(data.expires_at), installationId: app.installationId };
  return data.token;
}

// The token for GitHub's API, whichever way it's connected
export async function githubToken() {
  const s = saved;
  if (s?.repo && s.auth === "app" && s.app?.installationId) return installationToken(s.app);
  if (s?.repo && s.auth === "token") return open(s.token) ?? "";
  return process.env.MAINT_GITHUB_TOKEN ?? "";
}

// ---------- Secrets on GitHub (the AI keys) ----------

// GitHub only takes secrets encrypted with the repository's public key, in
// libsodium's "sealed box" format
async function encryptForGitHub(publicKey, value) {
  let sodium;
  try {
    sodium = (await import("libsodium-wrappers")).default;
  } catch {
    throw new BadInput(
      "The server is missing a package for this: run  cd server && npm install  and restart.",
    );
  }
  await sodium.ready;
  const box = sodium.crypto_box_seal(
    sodium.from_string(value),
    sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL),
  );
  return sodium.to_base64(box, sodium.base64_variants.ORIGINAL);
}

export async function putSecret(name, value) {
  const { repo } = maintenanceConfig();
  const token = await githubToken();
  const key = await call("GET", `/repos/${repo}/actions/secrets/public-key`, { token });
  const encrypted = await encryptForGitHub(key.key, value);
  await call("PUT", `/repos/${repo}/actions/secrets/${name}`, {
    token,
    body: { encrypted_value: encrypted, key_id: key.key_id },
  });
}

async function deleteSecret(name) {
  const { repo } = maintenanceConfig();
  await call("DELETE", `/repos/${repo}/actions/secrets/${name}`, { token: await githubToken() }).catch(
    (err) => {
      if (err.githubStatus !== 404) throw err;
    },
  );
}

// Which secrets are there (names and dates only: GitHub never shows values)
async function secretNames() {
  const { repo, configured } = maintenanceConfig();
  if (!configured) return {};
  try {
    const data = await call("GET", `/repos/${repo}/actions/secrets?per_page=100`, {
      token: await githubToken(),
    });
    return Object.fromEntries((data.secrets ?? []).map((s) => [s.name, s.updated_at]));
  } catch {
    return null; // can't tell (no permission to read secrets)
  }
}

// ---------- Continue with ChatGPT ----------

const openaiConfig = () => saved?.openai ?? {};

async function openaiTokenRequest(params) {
  const o = openaiConfig();
  const form = new URLSearchParams({ client_id: o.clientId, resource: OPENAI_RESOURCE, ...params });
  const secret = open(o.clientSecret);
  if (secret) form.set("client_secret", secret);
  let res;
  try {
    res = await fetch(OPENAI_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BadInput("Couldn't reach OpenAI. Try again in a minute.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BadInput(`OpenAI said: ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

function keepOpenAITokens(data, email) {
  const scopes = String(data.scope ?? "").split(/\s+/);
  if (!scopes.includes("chatgpt.tokens.use.direct"))
    throw new BadInput(
      "Signed in, but OpenAI didn't allow using the ChatGPT plan (it needs a Plus or Pro plan, and this helpdesk's OpenAI client to be approved for plan usage).",
    );
  return {
    tokens: seal(
      JSON.stringify({
        access: data.access_token,
        refresh: data.refresh_token,
        expires: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      }),
    ),
    email,
    signedInAt: Date.now(),
  };
}

// A ChatGPT access token good for the next 50 minutes, renewing it if
// needed. (OpenAI replaces the refresh token each time.)
export async function openaiAccessToken() {
  const o = openaiConfig();
  const tokens = JSON.parse(open(o.tokens) ?? "null");
  if (!tokens?.refresh) throw new BadInput("Sign in with ChatGPT again (Maintenance → AI & GitHub).");
  if (tokens.expires - Date.now() > 50 * MINUTE) return tokens.access;
  const data = await openaiTokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh });
  await save({ openai: { ...o, ...keepOpenAITokens({ ...data, refresh_token: data.refresh_token ?? tokens.refresh }, o.email) } });
  return data.access_token;
}

// Before each investigation: the right key for the chosen AI is where the
// workflow can use it
export async function prepareAiForInvestigation() {
  const config = maintenanceConfig();
  if (config.source !== "settings") return { provider: "github", model: "", auth: "key" };
  if (config.provider === "openai" && config.openaiMode === "signin")
    await putSecret(OPENAI_SIGNIN_SECRET, await openaiAccessToken());
  return {
    provider: config.provider,
    model: config.model || PROVIDERS[config.provider].model,
    auth: config.provider === "openai" ? config.openaiMode : "key",
  };
}

// ---------- One-time states for the browser round trips ----------

const pending = new Map(); // state -> { kind, userId, data, expires }
function newState(kind, userId, data) {
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const state = crypto.randomBytes(24).toString("hex");
  pending.set(state, { kind, userId, data, expires: Date.now() + 30 * MINUTE });
  return state;
}
function takeState(kind, state, userId) {
  const found = pending.get(String(state ?? ""));
  pending.delete(String(state ?? ""));
  if (!found || found.kind !== kind || found.userId !== userId || found.expires < Date.now())
    throw new BadInput("That link has expired or was already used. Start again from Maintenance.");
  return found.data;
}

const site = (req) => `${req.protocol}://${req.get("host")}`;
const back = (res, query) => res.redirect(`/maintenance?${new URLSearchParams(query)}`);

// ---------- What the page shows ----------

async function view() {
  await refreshConfig();
  const config = maintenanceConfig();
  const s = saved ?? DEFAULTS;
  const names = config.configured ? await secretNames() : {};
  const keys = Object.fromEntries(
    Object.entries(PROVIDERS)
      .filter(([, p]) => p.secret)
      .map(([id, p]) => [id, names === null ? "unknown" : names[p.secret] ? "set" : "missing"]),
  );
  const o = s.openai ?? {};
  return {
    source: config.source,
    repo: config.repo,
    connected: config.configured,
    auth: config.auth,
    app: s.app ? { slug: s.app.slug, htmlUrl: s.app.htmlUrl, installed: Boolean(s.app.installationId) } : null,
    provider: config.provider,
    model: config.model,
    openaiMode: config.openaiMode,
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, model: p.model, keyUrl: p.keyUrl ?? null }]),
    ),
    keys,
    openai: {
      clientId: o.clientId ?? "",
      hasClientSecret: Boolean(open(o.clientSecret)),
      signedIn: Boolean(open(o.tokens)),
      email: o.email ?? null,
      callbackUrl: null, // filled in by the route (needs the site's address)
    },
    auto: config.auto,
    maxPerDay: config.maxPerDay,
    maxPerMonth: config.maxPerMonth,
    allowPublic: config.allowPublic,
    approvers: config.approvers,
    webhook: Boolean(config.webhookSecret),
  };
}

// ---------- The settings (Super Admin) ----------

maintenanceSettingsRouter.use(requireRole("owner"));

const withSite = async (req) => {
  const v = await view();
  v.openai.callbackUrl = `${site(req)}/api/maintenance/openai/callback`;
  return v;
};

maintenanceSettingsRouter.get("/", async (req, res) => res.json(await withSite(req)));

maintenanceSettingsRouter.put("/", async (req, res) => {
  const b = req.body ?? {};
  const changes = {};
  if (b.provider !== undefined) {
    if (!PROVIDERS[b.provider]) throw new BadInput("Pick one of the AIs on the list.");
    changes.provider = b.provider;
  }
  if (b.model !== undefined) {
    const model = String(b.model).trim();
    if (model && !/^[\w./:-]{1,80}$/.test(model)) throw new BadInput("That model name doesn't look right.");
    changes.model = model;
  }
  if (b.openaiMode !== undefined) changes.openaiMode = b.openaiMode === "signin" ? "signin" : "key";
  if (b.auto !== undefined) changes.auto = Boolean(b.auto);
  if (b.allowPublic !== undefined) changes.allowPublic = Boolean(b.allowPublic);
  for (const [name, max] of [["maxPerDay", 50], ["maxPerMonth", 500]])
    if (b[name] !== undefined) {
      const n = Number(b[name]);
      if (!Number.isInteger(n) || n < 0 || n > max) throw new BadInput(`Use a whole number from 0 to ${max}.`);
      changes[name] = n;
    }
  if (b.approvers !== undefined) {
    const list = (Array.isArray(b.approvers) ? b.approvers : String(b.approvers).split(","))
      .map((a) => String(a).trim().replace(/^@/, ""))
      .filter(Boolean);
    for (const a of list)
      if (!/^[A-Za-z0-9-]{1,39}$/.test(a)) throw new BadInput(`"${a}" isn't a GitHub username.`);
    changes.approvers = list;
  }
  await save(changes);
  res.json(await withSite(req));
});

const REPO = /^[\w.-]{1,39}\/[\w.-]{1,100}$/;
function repoFrom(body) {
  const repo = String(body?.repo ?? "")
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (!REPO.test(repo)) throw new BadInput("Use the repository's owner and name, e.g. DarmaniBenjamin/helpdesk-platform.");
  return repo;
}

// The manifest: what the app may do, and where GitHub sends things
export function appManifest(siteUrl, repo) {
  const tag = crypto.randomBytes(2).toString("hex");
  return {
    // GitHub app names are unique and at most 34 characters
    name: `Helpdesk maintenance ${tag}`,
    url: siteUrl,
    description: `AI investigations for the helpdesk at ${siteUrl} (repository ${repo}).`,
    hook_attributes: { url: `${siteUrl}/api/maintenance/github-webhook`, active: true },
    redirect_url: `${siteUrl}/api/maintenance/github/created`,
    setup_url: `${siteUrl}/api/maintenance/github/installed`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      issues: "write", // open the issue the investigation runs on, read its result
      pull_requests: "read", // notice when a fix is merged or closed
      checks: "read", // update-uplink: did CI pass?
      secrets: "write", // store the AI's key, encrypted
      metadata: "read",
    },
    default_events: ["issue_comment", "pull_request", "pull_request_review"],
  };
}

maintenanceSettingsRouter.post("/github/start", async (req, res) => {
  const repo = repoFrom(req.body);
  const owner = repo.split("/")[0];
  // An organization makes its apps in its own settings
  const who = await call("GET", `/users/${owner}`).catch(() => ({ type: "User" }));
  const state = newState("github-app", req.user.id, { repo });
  const action =
    who.type === "Organization"
      ? `https://github.com/organizations/${owner}/settings/apps/new?state=${state}`
      : `https://github.com/settings/apps/new?state=${state}`;
  res.json({ action, manifest: JSON.stringify(appManifest(site(req), repo)) });
});

maintenanceSettingsRouter.post("/github/token", async (req, res) => {
  const repo = repoFrom(req.body);
  const token = String(req.body?.token ?? "").trim();
  if (token.length < 20) throw new BadInput("Paste the whole token.");
  await call("GET", `/repos/${repo}`, { token }); // it can see the repository
  await save({ repo, auth: "token", token: seal(token), app: null });
  res.json(await withSite(req));
});

maintenanceSettingsRouter.delete("/github", async (req, res) => {
  await save({ repo: "", auth: null, token: null, app: null });
  appToken = null;
  res.json(await withSite(req));
});

// What works, in plain words
maintenanceSettingsRouter.post("/github/test", async (req, res) => {
  const config = maintenanceConfig();
  const checks = [];
  const add = (ok, label, fix) => checks.push({ ok, label, fix: ok ? null : fix });
  if (!config.configured) {
    add(false, "Connected to GitHub", "Press Connect GitHub.");
    return res.json({ checks });
  }
  let token;
  try {
    token = await githubToken();
    add(true, "Connected to GitHub", null);
  } catch (err) {
    add(false, "Connected to GitHub", err.message);
    return res.json({ checks });
  }
  const probe = async (label, fix, run) => {
    try {
      await run();
      add(true, label, null);
    } catch (err) {
      add(false, label, `${fix} (${err.message})`);
    }
  };
  let repoInfo = null;
  await probe(`Can see ${config.repo}`, "Check the repository name, and that the app is installed on it.", async () => {
    repoInfo = await call("GET", `/repos/${config.repo}`, { token });
  });
  if (repoInfo)
    add(
      repoInfo.private || config.allowPublic,
      repoInfo.private ? "The repository is private" : "The repository is public",
      "Incidents are only sent to a private repository. While testing, turn on \"Allow a public repository\".",
    );
  await probe("Can read issues", "It needs Issues: Read and write.", () =>
    call("GET", `/repos/${config.repo}/issues?per_page=1`, { token }),
  );
  await probe("Can read pull requests", "It needs Pull requests: Read.", () =>
    call("GET", `/repos/${config.repo}/pulls?per_page=1`, { token }),
  );
  await probe("Can read secrets' names (to store the AI's key)", "It needs Secrets: Read and write.", () =>
    call("GET", `/repos/${config.repo}/actions/secrets/public-key`, { token }),
  );
  await probe("Can read CI results (for update-uplink)", "It needs Checks: Read.", async () => {
    const branch = repoInfo?.default_branch ?? "main";
    await call("GET", `/repos/${config.repo}/commits/${branch}/check-runs?per_page=1`, { token });
  });
  add(
    Boolean(config.webhookSecret) || config.auth === "token",
    "GitHub tells the helpdesk at once when a fix is merged",
    "Connect with the Connect GitHub button (its webhook is set up by itself).",
  );
  if (config.provider !== "github") {
    const names = await secretNames();
    const p = PROVIDERS[config.provider];
    const needed = config.provider === "openai" && config.openaiMode === "signin" ? null : p.secret;
    if (needed) add(Boolean(names?.[needed]), `${p.label}'s key is saved on GitHub`, `Paste your ${p.label} key and save it.`);
    if (config.provider === "openai" && config.openaiMode === "signin")
      add(Boolean(open(saved?.openai?.tokens)), "Signed in with ChatGPT", "Press Continue with ChatGPT.");
  }
  res.json({ checks });
});

maintenanceSettingsRouter.put("/key", async (req, res) => {
  const provider = String(req.body?.provider ?? "");
  const key = String(req.body?.key ?? "").trim();
  const p = PROVIDERS[provider];
  if (!p?.secret) throw new BadInput("That AI doesn't need a key.");
  if (key.length < 20 || /\s/.test(key)) throw new BadInput(`That doesn't look like a ${p.label} key: paste the whole key.`);
  if (!maintenanceConfig().configured) throw new BadInput("Connect GitHub first: the key is kept there.");
  await putSecret(p.secret, key);
  res.json(await withSite(req));
});

maintenanceSettingsRouter.delete("/key/:provider", async (req, res) => {
  const p = PROVIDERS[req.params.provider];
  if (!p?.secret) throw new BadInput("That AI doesn't have a key.");
  await deleteSecret(p.secret);
  res.json(await withSite(req));
});

maintenanceSettingsRouter.put("/openai-client", async (req, res) => {
  const clientId = String(req.body?.clientId ?? "").trim();
  const clientSecret = String(req.body?.clientSecret ?? "").trim();
  if (!/^[\w.-]{6,120}$/.test(clientId)) throw new BadInput("Paste the client ID OpenAI gave you (it usually starts with oaiapp_).");
  const o = openaiConfig();
  await save({
    openai: { ...o, clientId, ...(clientSecret ? { clientSecret: seal(clientSecret) } : {}) },
  });
  res.json(await withSite(req));
});

maintenanceSettingsRouter.delete("/openai", async (req, res) => {
  const o = openaiConfig();
  await save({ openai: { ...o, tokens: null, email: null, signedInAt: null } });
  await deleteSecret(OPENAI_SIGNIN_SECRET).catch(() => {});
  res.json(await withSite(req));
});

// ---------- The browser coming back from GitHub and OpenAI ----------

// (The Super Admin check is on each route, not router.use, so this router
// never gets in the way of other /api/maintenance routes like the webhook)
const owner = requireRole("owner");

// GitHub made the app: keep its credentials, then install it
maintenanceCallbacksRouter.get("/github/created", owner, async (req, res) => {
  try {
    const { repo } = takeState("github-app", req.query.state, req.user.id);
    const code = String(req.query.code ?? "");
    if (!/^[\w-]{1,100}$/.test(code)) throw new BadInput("GitHub didn't send a code back.");
    const app = await call("POST", `/app-manifests/${code}/conversions`);
    await save({
      repo,
      auth: "app",
      token: null,
      app: {
        id: app.id,
        slug: app.slug,
        htmlUrl: app.html_url,
        privateKey: seal(app.pem),
        webhookSecret: seal(app.webhook_secret),
        clientId: app.client_id,
        installationId: null,
      },
    });
    const state = newState("github-install", req.user.id, { repo });
    res.redirect(`${app.html_url}/installations/new?state=${state}`);
  } catch (err) {
    back(res, { error: err.message });
  }
});

// Installed: check it can see the repository, then back to Maintenance
maintenanceCallbacksRouter.get("/github/installed", owner, async (req, res) => {
  try {
    if (req.query.state) takeState("github-install", req.query.state, req.user.id);
    const app = saved?.app;
    const installationId = Number(req.query.installation_id) || 0;
    if (!app || !installationId) throw new BadInput("Connect GitHub again from the start.");
    const installation = await call("GET", `/app/installations/${installationId}`, { jwt: appJwt(app) });
    if (Number(installation.app_id) !== Number(app.id)) throw new BadInput("That isn't this helpdesk's app.");
    await save({ app: { ...app, installationId } });
    appToken = null;
    const token = await githubToken();
    const repos = await call("GET", "/installation/repositories?per_page=100", { token });
    const names = (repos.repositories ?? []).map((r) => r.full_name.toLowerCase());
    if (!names.includes(saved.repo.toLowerCase()))
      throw new BadInput(`The app was installed, but not on ${saved.repo}. On GitHub, open the app's settings and add that repository.`);
    back(res, { connected: "github" });
  } catch (err) {
    back(res, { error: err.message });
  }
});

// Continue with ChatGPT
maintenanceCallbacksRouter.get("/openai/signin", owner, (req, res) => {
  const o = openaiConfig();
  if (!o.clientId) return back(res, { error: "Paste the client ID OpenAI gave you first." });
  const verifier = crypto.randomBytes(48).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${site(req)}/api/maintenance/openai/callback`;
  const state = newState("openai", req.user.id, { verifier, redirectUri });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: redirectUri,
    scope: OPENAI_SCOPES,
    state,
    nonce,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: OPENAI_RESOURCE,
    agent_name_hint: "Helpdesk maintenance",
  });
  res.redirect(`${OPENAI_AUTH}?${params}`);
});

maintenanceCallbacksRouter.get("/openai/callback", owner, async (req, res) => {
  try {
    if (req.query.error) throw new BadInput(`OpenAI said: ${req.query.error_description ?? req.query.error}`);
    const { verifier, redirectUri } = takeState("openai", req.query.state, req.user.id);
    const data = await openaiTokenRequest({
      grant_type: "authorization_code",
      code: String(req.query.code ?? ""),
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    // Only the email, to show who's signed in (straight from OpenAI's token
    // endpoint over https)
    let email = null;
    try {
      email = JSON.parse(Buffer.from(String(data.id_token).split(".")[1], "base64url").toString()).email ?? null;
    } catch {
      // no email: fine
    }
    await save({ openai: { ...openaiConfig(), ...keepOpenAITokens(data, email) }, openaiMode: "signin" });
    back(res, { connected: "chatgpt" });
  } catch (err) {
    back(res, { error: err.message });
  }
});
