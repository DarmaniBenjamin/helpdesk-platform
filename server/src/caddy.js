// Sets up Caddy (the web server that handles https and the Let's
// Encrypt certificates) from here, so there's no Caddyfile to write by
// hand. deploy/install-caddy.sh only installs Caddy; this does the rest.
//
// Caddy has a small settings API on this computer only
// (http://127.0.0.1:2019). When the server starts, and then every 30
// seconds, this checks Caddy is there and has the helpdesk's settings;
// if Caddy was restarted or just installed, it gets them again. The
// settings are:
//   - answer https on port 443 for any domain, and send http:// on
//     port 80 to https:// (Caddy does that part by itself)
//   - before getting a certificate for a domain, ask this app if it's
//     one of ours (GET /api/domains/allowed, see domains.js)
//   - get the certificates from Let's Encrypt, using CADDY_EMAIL (or
//     the Super Admin's email) for the account
//   - pass every request on to this app
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

// The settings, in Caddy's own format (JSON)
function caddyConfig() {
  const app = `127.0.0.1:${appPort()}`;
  const issuer = { module: "acme" };
  if (email()) issuer.email = email();
  return {
    apps: {
      http: {
        servers: {
          helpdesk: {
            "@id": ID,
            listen: [":443"],
            routes: [
              {
                handle: [
                  // Smaller downloads
                  {
                    handler: "encode",
                    encodings: { gzip: {}, zstd: {} },
                    prefer: ["zstd", "gzip"],
                  },
                  // Everything goes to this app
                  { handler: "reverse_proxy", upstreams: [{ dial: app }] },
                ],
              },
            ],
            tls_connection_policies: [{}],
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

// Make sure Caddy has our settings. Returns the status.
// force: send them even if Caddy already has them (e.g. on start-up,
// in case the port or email changed)
export async function syncCaddy({ force = false } = {}) {
  if (!MANAGED) {
    status = { reachable: false, configured: false, error: "off" };
    return status;
  }
  try {
    if (!force) {
      const res = await caddy(`/id/${ID}`);
      if (res.ok) {
        status = { reachable: true, configured: true, error: null };
        return status;
      }
    }
    const res = await caddy("/load", {
      method: "POST",
      body: JSON.stringify(caddyConfig()),
    });
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
    status = { reachable: true, configured: true, error: null };
  } catch {
    // Caddy isn't installed or isn't running (normal while developing)
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
