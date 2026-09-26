// A tiny helper that only runs while you use `npm run dev`.
//
// Freshdesk blocks requests made straight from a web page, so the page asks
// your own computer instead (at /freshdesk-api/...), and this passes the
// request on to https://<your-address>.freshdesk.com/api/v2/...
//
// It only allows reading (GET), so nothing in Freshdesk can be changed.
// The API key is never stored: the page sends it with each request.
// Once the real backend exists, it takes over this job.

export default function freshdeskDevProxy() {
  return {
    name: "freshdesk-dev-proxy",
    apply: "serve", // dev server only, never part of the built website
    configureServer(server) {
      server.middlewares.use("/freshdesk-api", async (req, res) => {
        function fail(status, error) {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error }));
        }

        if (req.method !== "GET") {
          fail(405, "Only reading from Freshdesk is allowed.");
          return;
        }

        // Only letters, numbers and dashes, so it can only ever reach
        // a *.freshdesk.com address
        const domain = String(req.headers["x-freshdesk-domain"] ?? "")
          .trim()
          .toLowerCase();
        const key = String(req.headers["x-freshdesk-key"] ?? "").trim();
        if (!/^[a-z0-9-]+$/.test(domain) || !key) {
          fail(400, "Missing the Freshdesk address or API key.");
          return;
        }

        try {
          const answer = await fetch(
            `https://${domain}.freshdesk.com/api/v2${req.url}`,
            {
              headers: {
                // Freshdesk's login: the API key as the username, "X" as the password
                Authorization: `Basic ${btoa(`${key}:X`)}`,
                "Content-Type": "application/json",
              },
            },
          );
          res.statusCode = answer.status;
          for (const header of [
            "content-type",
            "retry-after",
            "x-ratelimit-remaining",
            "x-ratelimit-total",
          ]) {
            const value = answer.headers.get(header);
            if (value) res.setHeader(header, value);
          }
          res.end(new Uint8Array(await answer.arrayBuffer()));
        } catch {
          fail(502, `Couldn't reach ${domain}.freshdesk.com.`);
        }
      });
    },
  };
}
