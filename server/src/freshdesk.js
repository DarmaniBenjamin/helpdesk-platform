// Talking to Freshdesk for the import (Settings → Import from Freshdesk).
//
// Freshdesk doesn't let web pages call it directly, so the page asks
// this server (at /freshdesk-api/...), and the server passes the
// request on to https://<your-address>.freshdesk.com/api/v2/...
// (While developing, freshdeskDevProxy.js in the main folder does the
// same job inside the Vite dev server.)
//
// Admins and the Super Admin only. It only allows reading (GET), so
// nothing in Freshdesk can be changed. The API key is never stored:
// the page sends it with each request.
import { Router } from "express";
import { requireRole } from "./auth.js";
import { ADMINS } from "./permissions.js";

export const freshdeskRouter = Router();

freshdeskRouter.get("/*path", requireRole(...ADMINS), async (req, res) => {
  // Only letters, numbers and dashes, so it can only ever reach a
  // *.freshdesk.com address
  const domain = String(req.get("x-freshdesk-domain") ?? "")
    .trim()
    .toLowerCase();
  const key = String(req.get("x-freshdesk-key") ?? "").trim();
  if (!/^[a-z0-9-]+$/.test(domain) || !key) {
    return res
      .status(400)
      .json({ error: "Missing the Freshdesk address or API key." });
  }

  // Everything after /freshdesk-api, with its ?query
  const rest = req.originalUrl.replace(/^\/freshdesk-api/, "");
  try {
    const answer = await fetch(
      `https://${domain}.freshdesk.com/api/v2${rest}`,
      {
        headers: {
          // Freshdesk's login: the API key as the username, "X" as the password
          Authorization: `Basic ${Buffer.from(`${key}:X`).toString("base64")}`,
          "Content-Type": "application/json",
        },
      },
    );
    res.status(answer.status);
    for (const header of [
      "content-type",
      "retry-after",
      "x-ratelimit-remaining",
      "x-ratelimit-total",
    ]) {
      const value = answer.headers.get(header);
      if (value) res.set(header, value);
    }
    res.send(Buffer.from(await answer.arrayBuffer()));
  } catch {
    res.status(502).json({ error: `Couldn't reach ${domain}.freshdesk.com.` });
  }
});

// Only reading is allowed
freshdeskRouter.all("/*path", (req, res) => {
  res.status(405).json({ error: "Only reading from Freshdesk is allowed." });
});
