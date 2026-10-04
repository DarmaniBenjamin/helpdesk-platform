// Sets up Caddy (the web server that handles https and the Let's
// Encrypt certificates) from here, so there's no Caddyfile to write by
// hand. deploy/install-caddy.sh only installs Caddy; this does the rest.
//
// Caddy has a small settings API on this computer only
// (http://127.0.0.1:2019). When the server starts, whenever the domain
// list changes, and every 30 seconds, this checks Caddy has the
// helpdesk's current settings, and sends them again if not (e.g. Caddy
// was restarted or just installed, or a backup was restored).
//
// The settings, while there's at least one domain on the list in
// Settings → Domain & SSL:
//   - https on port 443 for those domains only: anything else (a
//     removed domain, the bare IP) gets a short "not set up" message
//   - before getting a certificate for a domain, Caddy asks this app if
//     it's on the list (GET /api/domains/allowed, see domains.js)
//   - certificates from Let's Encrypt, using CADDY_EMAIL (or the Super
//     Admin's email) for the account
//   - http on port 80: the domains are sent on to https, and opening the
//     server's IP sends you on to the first secure domain
//
// While none of the domains on the list works yet (none has a working
// certificate, or there are none at all), the site would be locked out
// completely. So then, and only then, opening the server's IP over plain
// http shows the site instead, so someone can sign in and add or fix a
// domain. As soon as one domain is secure, that stops again.
//
// Server environment variables (all optional):
//   CADDY_EMAIL   email for the Let's Encrypt account. Default: the
//                 Super Admin's email (SUPER_ADMIN_EMAIL).
//   CADDY_ADMIN   where Caddy's settings API is. Default:
//                 http://127.0.0.1:2019. Set it to "off" if this
//                 computer's Caddy is used for other things and the
//                 helpdesk shouldn't change its settings.
//
// Note: these settings replace whatever Caddy was set up to do before,
// so use a Caddy that's just for the helpdesk.

const ADMIN = (process.env.CADDY_ADMIN || "http://127.0.0.1:2019").replace(
  /\/$/,
  "",
);
// Not on Render: Render handles https itself
const ON_RENDER = process.env.RENDER && process.env.SSL_MODE !== "server";
const MANAGED = ADMIN !== "off" && !ON_RENDER;
const ID = "helpdesk"; // marks the settings as ours
const CHECK_EVERY = 30 * 1000;

// What Caddy last told us: is it there, and does it have our settings
let status = { reachable: false, configured: false, error: null };
// The settings last sent, to notice when they need sending again
let lastSent = null;

// Where the domain list comes from (domains.js sets this, so the two
// files don't need to import each other):
// { names: [...], secure: [...the ones with a working certificate] }
let getDomains = async () => ({ names: [], secure: [] });
export function setDomainSource(fn) {
  getDomains = fn;
}

function appPort() {
  return Number(process.env.PORT) || 4000;
}

function email() {
  return (
    process.env.CADDY_EMAIL?.trim() ||
    process.env.SUPER_ADMIN_EMAIL?.trim() ||
    undefined
  );
}

// A plain text answer from Caddy itself
function message(statusCode, text) {
  return {
    handler: "static_response",
    status_code: statusCode,
    headers: { "Content-Type": ["text/plain; charset=utf-8"] },
    body: text,
  };
}

// The settings, in Caddy's own format (JSON), for these domains
function caddyConfig({ names: domains, secure }) {
  const app = `127.0.0.1:${appPort()}`;
  const issuer = { module: "acme" };
  if (email()) issuer.email = email();

  const toApp = [
    // Smaller downloads
    {
      handler: "encode",
      encodings: { gzip: {}, zstd: {} },
      prefer: ["zstd", "gzip"],
    },
    { handler: "reverse_proxy", upstreams: [{ dial: app }] },
  ];
  const notSetUp = message(
    404,
    "This address isn't set up on this helpdesk.\n",
  );

  // Port 80 (http)
  const httpRoutes = [
    // The domains: on to https
    ...(domains.length
      ? [
          {
            match: [{ host: domains }],
            handle: [
              {
                handler: "static_response",
                status_code: 308,
                headers: {
                  Location: ["https://{http.request.host}{http.request.uri}"],
                },
              },
            ],
          },
        ]
      : []),
    // The IP (or anything else): on to the first secure domain, or, with
    // none working yet, the site itself so a domain can be added or fixed
    secure.length
      ? {
          handle: [
            {
              handler: "static_response",
              status_code: 302,
              headers: { Location: [`https://${secure[0]}/`] },
            },
          ],
        }
      : { handle: toApp },
  ];

  return {
    apps: {
      http: {
        servers: {
          helpdesk: {
            "@id": ID,
            listen: [":443"],
            routes: [
              ...(domains.length
                ? [{ match: [{ host: domains }], handle: toApp }]
                : []),
              { handle: [notSetUp] },
            ],
            tls_connection_policies: [{}],
            // Port 80 is set up below instead
            automatic_https: { disable_redirects: true },
          },
          "helpdesk-http": {
            listen: [":80"],
            routes: httpRoutes,
          },
        },
      },
      tls: {
        automation: {
          policies: [{ issuers: [issuer], on_demand: true }],
          on_demand: {
            permission: {
              module: "http",
              endpoint: `http://${app}/api/domains/allowed`,
            },
          },
        },
      },
    },
  };
}

// One request to Caddy's settings API. Caddy only accepts changes from
// requests that say they come from its own address (Origin), which
// stops web pages in a browser on this computer from changing it.
async function caddy(path, { method = "GET", body } = {}) {
  const { origin } = new URL(ADMIN);
  const res = await fetch(`${ADMIN}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    signal: AbortSignal.timeout(5000),
  });
  return res;
}

// Make sure Caddy has the current settings. Returns the status.
// force: send them even if nothing seems to have changed (e.g. on
// start-up, in case the port or email changed)
export async function syncCaddy({ force = false } = {}) {
  if (!MANAGED) {
    status = { reachable: false, configured: false, error: "off" };
    return status;
  }
  try {
    const config = JSON.stringify(caddyConfig(await getDomains()));
    if (!force && config === lastSent) {
      const res = await caddy(`/id/${ID}`);
      if (res.ok) {
        status = { reachable: true, configured: true, error: null };
        return status;
      }
    }
    const res = await caddy("/load", { method: "POST", body: config });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      status = {
        reachable: true,
        configured: false,
        error: text.slice(0, 300) || `Caddy answered ${res.status}`,
      };
      console.warn("Caddy didn't take the helpdesk's settings:", status.error);
      return status;
    }
    if (!status.configured)
      console.log("Caddy is set up: https and certificates are on.");
    lastSent = config;
    status = { reachable: true, configured: true, error: null };
  } catch {
    // Caddy isn't installed or isn't running (normal while developing)
    lastSent = null;
    status = { reachable: false, configured: false, error: null };
  }
  return status;
}

export function caddyStatus() {
  return { managed: MANAGED, ...status };
}

// When the server starts: send the settings, then check every 30
// seconds (so a restarted or newly installed Caddy gets them too)
export function startCaddySync() {
  if (!MANAGED) return;
  syncCaddy({ force: true });
  setInterval(() => syncCaddy(), CHECK_EVERY).unref();
}
