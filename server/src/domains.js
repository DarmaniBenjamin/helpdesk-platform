// Your own domain (like helpdesk.yourcompany.com) with a free SSL
// certificate from Let's Encrypt, from Settings → Domain & SSL. You type
// the domain in, point its DNS here, and the certificate is made and
// renewed by itself.
//
// It works two ways, depending on where the site runs:
//
// 1. Your own server (a VM on Linode, Google Cloud, Oracle, AWS, your
//    homelab...). This is the normal way. Caddy (a small web server)
//    sits in front of this app on ports 80 and 443 and handles https.
//    deploy/install-caddy.sh installs it, and this app sets it up by
//    itself (caddy.js). When someone opens a domain Caddy has no
//    certificate for yet, Caddy first asks this app
//    "is this one of ours?" (GET /api/domains/allowed?domain=...). Only
//    domains added here (or in SITE_DOMAIN) get a yes, so nobody can make
//    Caddy request certificates for domains that aren't yours. Caddy
//    then gets the certificate from Let's Encrypt in a few seconds, keeps
//    it, and renews it well before it runs out.
//    Moving to another provider: install Caddy there, point the A record
//    at the new server's IP, done.
//
// 2. Render (for testing). Render handles https itself in front of the
//    app, so instead this asks Render's API to add the domain, and Render
//    gets and renews the certificate. Needs RENDER_API_KEY. Used when
//    the app is running on Render (Render sets RENDER=true).
//
// Server environment variables (server/.env on a VM):
//   SITE_DOMAIN     optional. The site's main domain(s), comma-separated,
//                   e.g. helpdesk.darmani.com. Always allowed, so the
//                   site is secure from the very first start, before
//                   anyone has signed in to add it here.
//   SERVER_IP       optional. This server's public IP, shown as what the
//                   A record should point to. Found by itself if empty.
//   SSL_MODE        optional. "server" or "render", to override the
//                   automatic choice.
//   RENDER_API_KEY  Render only. Render → Account Settings → API Keys.
//                   It can change everything on your Render account, so
//                   it only ever lives in the environment.
//   RENDER_SERVICE_ID  Render only. Render sets it by itself.
//
//   GET    /api/domains/allowed?domain=  Caddy's question (this server only)
//   GET    /api/domains              the domains, their DNS and certificates
//   POST   /api/domains              add one: { "name": "helpdesk.example.com" }
//   POST   /api/domains/:name/check  check again now
//   DELETE /api/domains/:name        remove one
// All but the first are Super Admin only.
import { Router } from "express";
import net from "node:net";
import tls from "node:tls";
import { Resolver } from "node:dns/promises";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { requireRole } from "./auth.js";
import { BadInput } from "./validate.js";
import { syncCaddy, caddyStatus } from "./caddy.js";

export const domainsRouter = Router();

const MODE =
  process.env.SSL_MODE === "render" || process.env.SSL_MODE === "server"
    ? process.env.SSL_MODE
    : process.env.RENDER
      ? "render"
      : "server";

// ============================================================
// Shared helpers
// ============================================================

// Cleans up what was typed: "https://Helpdesk.Example.com/" becomes
// "helpdesk.example.com". Only real-looking domain names get through.
function cleanDomain(value) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "") // https://
    .replace(/[/?#].*$/, "") // /anything after it
    .replace(/:\d+$/, "") // :443
    .replace(/\.$/, ""); // a dot at the end
  if (name.startsWith("*."))
    throw new BadInput("Wildcard domains aren't supported here.");
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const valid = new RegExp(`^(?:${label}\\.)+[a-z]{2,63}$`);
  if (!name || name.length > 253 || !valid.test(name))
    throw new BadInput(
      "Enter a domain name like helpdesk.yourcompany.com or yourcompany.com.",
    );
  if (name.endsWith(".onrender.com"))
    throw new BadInput("That's Render's own address. It already has SSL.");
  return name;
}

// A guess at the DNS "Name / Host" part: "helpdesk" for
// helpdesk.darmani.com, "@" for darmani.com. Most domains end in one
// word (.com, .net, .gd); two-part endings like .co.uk are handled too.
const TWO_PART_ENDINGS = /\.(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/;
function hostPart(name, publicSuffix) {
  const parts = name.split(".");
  const suffixLength = publicSuffix
    ? publicSuffix.split(".").length
    : TWO_PART_ENDINGS.test(name)
      ? 2
      : 1;
  const extra = parts.length - (suffixLength + 1);
  return extra > 0 ? parts.slice(0, extra).join(".") : "@";
}

// What the domain points to right now on the internet, asked of public
// DNS servers (not this server's own cache), so changes show up sooner
async function currentDns(name) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const [cname, a, aaaa] = await Promise.all([
    resolver.resolveCname(name).catch(() => []),
    resolver.resolve4(name).catch(() => []),
    resolver.resolve6(name).catch(() => []),
  ]);
  return [
    ...cname.map((value) => ({ type: "CNAME", value })),
    ...a.map((value) => ({ type: "A", value })),
    ...aaaa.map((value) => ({ type: "AAAA", value })),
  ];
}

// Plain words for why a secure connection didn't work yet
const CERT_PROBLEMS = {
  ENOTFOUND: "The domain doesn't point anywhere yet.",
  EAI_AGAIN: "The domain doesn't point anywhere yet.",
  ECONNREFUSED: "Nothing answered on port 443 at this domain yet.",
  ETIMEDOUT: "Nothing answered on this domain yet.",
  TIMEOUT: "Nothing answered on this domain yet.",
  ECONNRESET: "The certificate for this domain hasn't been made yet.",
  ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR:
    "The certificate for this domain hasn't been made yet.",
  ERR_TLS_CERT_ALTNAME_INVALID:
    "The certificate for this domain hasn't been made yet.",
  CERT_HAS_EXPIRED: "The certificate has run out.",
  DEPTH_ZERO_SELF_SIGNED_CERT:
    "The certificate for this domain hasn't been made yet.",
  SELF_SIGNED_CERT_IN_CHAIN:
    "The certificate for this domain hasn't been made yet.",
};

// Actually connects to https://name, the same way a browser does, and
// checks the certificate is real and for this name. That's the honest
// answer to "is it secure?". With Caddy, this also nudges it: the first
// visit to a new domain is what makes Caddy fetch its certificate.
// ip: the address public DNS gives for the domain (what visitors get).
// It's used instead of this server's own DNS, which can keep an old
// answer for an hour or more after the A record changes.
function checkCertificate(name, ip) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    const socket = tls.connect(
      { host: ip || name, port: 443, servername: name, timeout: 10000 },
      () => {
        const cert = socket.getPeerCertificate();
        finish({
          secure: true,
          issuer: cert?.issuer?.O ?? null,
          expiresAt: cert?.valid_to ? Date.parse(cert.valid_to) : null,
        });
      },
    );
    socket.on("timeout", () =>
      finish({ secure: false, problem: CERT_PROBLEMS.TIMEOUT }),
    );
    socket.on("error", (err) =>
      finish({
        secure: false,
        problem:
          CERT_PROBLEMS[err.code] ??
          "A secure connection to this domain didn't work yet.",
      }),
    );
  });
}

function statusOf(dnsVerified, certificate) {
  if (certificate.secure) return "secure";
  return dnsVerified ? "issuing" : "waiting-dns";
}

// ============================================================
// 1. Your own server, with Caddy in front
// ============================================================

// The domains added here, kept in the settings table (so they're in
// backups too): { list: [{ name, addedAt }] }
async function savedDomains() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "domains"));
  return row?.value?.list ?? [];
}

async function saveDomains(list) {
  const value = { list };
  await db
    .insert(settings)
    .values({ key: "domains", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

// The ones in SITE_DOMAIN, which are always allowed
function fixedDomains() {
  return (process.env.SITE_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      try {
        return cleanDomain(d);
      } catch {
        console.warn(`SITE_DOMAIN: "${d}" isn't a valid domain, skipped.`);
        return null;
      }
    })
    .filter(Boolean);
}

async function isAllowed(name) {
  if (fixedDomains().includes(name)) return true;
  return (await savedDomains()).some((d) => d.name === name);
}

// This server's public IP: SERVER_IP, or asked of a "what's my IP"
// service and remembered for an hour
let ipCache = { ip: null, at: 0 };
async function serverIp() {
  if (process.env.SERVER_IP) return process.env.SERVER_IP.trim();
  if (ipCache.ip && Date.now() - ipCache.at < 60 * 60 * 1000) return ipCache.ip;
  for (const url of [
    "https://api.ipify.org",
    "https://checkip.amazonaws.com",
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const ip = (await res.text()).trim();
      if (net.isIPv4(ip)) {
        ipCache = { ip, at: Date.now() };
        return ip;
      }
    } catch {
      // try the next one
    }
  }
  return null;
}

async function describeOwn({ name, addedAt, fixed }, ip) {
  const found = await currentDns(name);
  const ipv4 = found.filter((r) => r.type === "A").map((r) => r.value);
  const certificate = await checkCertificate(name, ipv4[0]);
  const dnsVerified = ip ? ipv4.includes(ip) : ipv4.length > 0;
  const host = hostPart(name);
  return {
    name,
    type: host === "@" ? "root" : "subdomain",
    redirectsTo: null,
    addedAt: addedAt ?? null,
    fixed: Boolean(fixed),
    dnsVerified,
    records: [{ type: "A", host, value: ip ?? "this server's public IP" }],
    found,
    hasIpv6: found.some((r) => r.type === "AAAA"),
    certificate,
    status: statusOf(dnsVerified, certificate),
  };
}

async function listOwn() {
  const [ip, , saved] = await Promise.all([
    serverIp(),
    syncCaddy(), // also gives a newly installed Caddy its settings
    savedDomains(),
  ]);
  const fixed = fixedDomains();
  const all = [
    ...fixed.map((name) => ({ name, fixed: true })),
    ...saved.filter((d) => !fixed.includes(d.name)),
  ];
  const domains = await Promise.all(all.map((d) => describeOwn(d, ip)));
  return {
    mode: "server",
    connected: true,
    missing: [],
    serverIp: ip,
    caddy: caddyStatus(),
    target: null,
    domains,
  };
}

async function addOwn(name) {
  if (fixedDomains().includes(name))
    throw new BadInput("That domain is already set in SITE_DOMAIN.");
  const list = await savedDomains();
  if (list.some((d) => d.name === name))
    throw new BadInput("That domain is already added.");
  if (list.length >= 20)
    throw new BadInput("That's the most domains this page can hold (20).");
  await saveDomains([...list, { name, addedAt: Date.now() }]);
}

async function removeOwn(name) {
  if (fixedDomains().includes(name))
    throw new BadInput(
      "That domain is set in SITE_DOMAIN on the server. Remove it there.",
    );
  const list = await savedDomains();
  await saveDomains(list.filter((d) => d.name !== name));
}

// ============================================================
// 2. Render (for testing)
// ============================================================

const RENDER_API = "https://api.render.com/v1";
// Render's address for root domains (example.com), from Render's custom
// domain guide. Subdomains point at the service's .onrender.com name.
const RENDER_IP = "216.24.57.1";

function renderEnv() {
  const key = process.env.RENDER_API_KEY?.trim();
  const serviceId = process.env.RENDER_SERVICE_ID?.trim();
  const missing = [];
  if (!key) missing.push("RENDER_API_KEY");
  if (!serviceId) missing.push("RENDER_SERVICE_ID");
  return { key, serviceId, missing };
}

// What to say when Render says no
function renderProblem(status, data) {
  const fromRender = data?.message ? ` (Render said: ${data.message})` : "";
  switch (status) {
    case 400:
      return `Render didn't accept that domain${fromRender}.`;
    case 401:
      return "Render didn't accept the API key. Make a new one in Render (Account Settings → API Keys) and put it in RENDER_API_KEY.";
    case 402:
      return "Render needs payment details on your account before it allows another custom domain.";
    case 403:
      return "That API key isn't allowed to change this service. Make the key on the account that owns the service.";
    case 404:
      return "Render couldn't find that. Check that RENDER_SERVICE_ID is this web service's ID (srv-...).";
    case 409:
      return "That domain is already added, here or on another Render service.";
    case 429:
      return "Too many requests to Render just now. Wait a minute and try again.";
    default:
      return `Render didn't answer properly${fromRender}. Try again in a minute.`;
  }
}

// One request to Render's API for this service
async function render(path, { method = "GET", body } = {}) {
  const { key, serviceId } = renderEnv();
  let res;
  try {
    res = await fetch(`${RENDER_API}/services/${serviceId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BadInput("Couldn't reach Render. Try again in a minute.", 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new BadInput(
      renderProblem(res.status, data),
      res.status === 404 ? 404 : 400,
    );
  return data;
}

// The service's own Render address (something.onrender.com), which
// subdomains point at. Looked up once, then remembered.
let serviceHost = process.env.RENDER_EXTERNAL_HOSTNAME || null;
async function getServiceHost() {
  if (serviceHost) return serviceHost;
  const service = await render("").catch(() => null);
  const url = service?.serviceDetails?.url;
  if (url) serviceHost = new URL(url).hostname;
  return serviceHost;
}

// Render's answers come either as the domain itself or wrapped as
// { customDomain: {...} }, alone or in a list. This handles all of them.
function unwrapList(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((item) => item?.customDomain ?? item).filter(Boolean);
}

async function describeRender(domain, target) {
  const apex = domain.domainType === "apex";
  const dnsVerified = domain.verificationStatus === "verified";
  const found = await currentDns(domain.name);
  const firstIp = found.find((r) => r.type === "A")?.value;
  const certificate = await checkCertificate(domain.name, firstIp);
  const host = apex ? "@" : hostPart(domain.name, domain.publicSuffix);
  return {
    name: domain.name,
    type: apex ? "root" : "subdomain",
    // e.g. www.example.com, which Render adds by itself and which just
    // sends visitors on to example.com
    redirectsTo: domain.redirectForName || null,
    addedAt: domain.createdAt ? Date.parse(domain.createdAt) : null,
    fixed: false,
    dnsVerified,
    records: apex
      ? [{ type: "A", host, value: RENDER_IP }]
      : [
          {
            type: "CNAME",
            host,
            value: target ?? "your-service.onrender.com",
          },
        ],
    found,
    hasIpv6: found.some((r) => r.type === "AAAA"),
    certificate,
    status: statusOf(dnsVerified, certificate),
  };
}

async function listRender() {
  const { missing } = renderEnv();
  const base = {
    mode: "render",
    connected: missing.length === 0,
    missing,
    onRender: Boolean(process.env.RENDER),
    serverIp: null,
    caddy: null,
    target: null,
    domains: [],
  };
  if (missing.length) return base;

  const [target, data] = await Promise.all([
    getServiceHost(),
    render("/custom-domains?limit=100"),
  ]);
  const domains = await Promise.all(
    unwrapList(data).map((d) => describeRender(d, target)),
  );
  // Main domains first, each followed by the one that redirects to it
  domains.sort((a, b) => {
    const keyA = a.redirectsTo ?? a.name;
    const keyB = b.redirectsTo ?? b.name;
    if (keyA !== keyB) return keyA.localeCompare(keyB);
    return a.redirectsTo ? 1 : -1;
  });
  return { ...base, target, domains };
}

function requireRenderConnected() {
  const { missing } = renderEnv();
  if (missing.length)
    throw new BadInput(
      `Connect Render first: ${missing.join(" and ")} ${
        missing.length > 1 ? "are" : "is"
      } missing on the server.`,
    );
}

// ============================================================
// The routes
// ============================================================

const list = () => (MODE === "render" ? listRender() : listOwn());

// Caddy's question: "may I get a certificate for this domain?"
// 200 = yes, 404 = no. It's only answered for requests made on this
// server itself (Caddy), not ones coming in from the internet through
// Caddy, which always carry an X-Forwarded-For header.
const LOCAL = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
domainsRouter.get("/allowed", async (req, res) => {
  const local =
    LOCAL.includes(req.socket.remoteAddress) && !req.get("x-forwarded-for");
  if (!local) return res.status(404).json({ error: "Not found" });
  let name;
  try {
    name = cleanDomain(req.query.domain);
  } catch {
    return res.status(404).json({ allowed: false });
  }
  if (await isAllowed(name)) return res.json({ allowed: true });
  res.status(404).json({ allowed: false });
});

// Everything below: Super Admin only
domainsRouter.use(requireRole("owner"));

domainsRouter.get("/", async (req, res) => {
  res.json(await list());
});

domainsRouter.post("/", async (req, res) => {
  const name = cleanDomain(req.body?.name);
  if (MODE === "render") {
    requireRenderConnected();
    await render("/custom-domains", { method: "POST", body: { name } });
  } else {
    await addOwn(name);
  }
  res.status(201).json(await list());
});

domainsRouter.post("/:name/check", async (req, res) => {
  const name = cleanDomain(req.params.name);
  if (MODE === "render") {
    requireRenderConnected();
    // Render answers "started" straight away and checks in the
    // background, so give it a moment before looking again
    await render(`/custom-domains/${encodeURIComponent(name)}/verify`, {
      method: "POST",
    });
    await new Promise((r) => setTimeout(r, 2500));
  }
  // With Caddy, listing again checks the DNS and connects to the domain,
  // which is what makes Caddy fetch the certificate
  res.json(await list());
});

domainsRouter.delete("/:name", async (req, res) => {
  const name = cleanDomain(req.params.name);
  if (MODE === "render") {
    requireRenderConnected();
    await render(`/custom-domains/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  } else {
    await removeOwn(name);
  }
  res.json(await list());
});
