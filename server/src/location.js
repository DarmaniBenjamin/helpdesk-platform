// Turning a maps link into coordinates.
//
// Pasting a full Google/Apple Maps link already works on the page itself
// (src/location.js parseLocation), because the numbers are in the link.
// But the "Copy link" / Share button on a pin usually gives a SHORT link
// (like https://maps.app.goo.gl/XXXX) that has no numbers in it: it just
// redirects to the real page. This opens that link, server-side, follows
// where it goes, and reads the coordinates out, so staff can paste the
// short link straight in instead of hunting for the numbers.
//
//   POST /api/location/resolve  { url } → { lat, lng }
//
// Safety: it will only ever open Google's and Apple's own addresses (the
// allow-list below), never anything else, so it can't be pointed at some
// other server. Every redirect it follows must stay on one of those too.
import { Router } from "express";
import { requireRole } from "./auth.js";
import { STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";

export const locationRouter = Router();

// Only Google's and Apple's own addresses. `host === name` allows the bare
// domain; `.name` (with the dot) allows their sub-addresses, but never a
// look-alike like "evilgoogle.com" or "google.com.attacker.net".
export function allowedHost(host) {
  host = String(host).toLowerCase();
  const is = (name) => host === name || host.endsWith(`.${name}`);
  return (
    is("google.com") || // google.com, maps.google.com, consent.google.com…
    is("goo.gl") || // goo.gl, maps.app.goo.gl (the short links)
    is("g.co") ||
    is("apple.com") || // maps.apple.com
    is("apple.co") ||
    // Google's country addresses, e.g. maps.google.co.uk, maps.google.gd
    /^(maps|www)\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)
  );
}

// lat,lng out of a link or a bit of a page. The first ones are how Google
// and Apple put coordinates in their links; the last two catch them in
// the page itself when the link alone doesn't have them.
const PATTERNS = [
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // Google place: !3d<lat>!4d<lng>
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, // …/@lat,lng,zoom
  /[?&](?:q|ll|query|daddr|destination|sll|center|coordinate|near)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  /"latitude"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*"longitude"\s*:\s*(-?\d+(?:\.\d+)?)/,
  /\[\[null,null,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/, // Google's page data
];
export function coordsFrom(text) {
  for (const p of PATTERNS) {
    const m = String(text).match(p);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng))
      return { lat, lng };
  }
  return null;
}

// Read at most `max` bytes of a response, so a huge page can't be pulled
// into memory
async function readCapped(res, max) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

// A gentle limit, since each call makes the server open a link: 20 a
// minute per person
const recent = new Map(); // userId -> [times]
function tooMany(userId) {
  const now = Date.now();
  const times = (recent.get(userId) ?? []).filter((t) => now - t < 60 * 1000);
  times.push(now);
  recent.set(userId, times);
  return times.length > 20;
}

locationRouter.post("/resolve", requireRole(...STAFF), async (req, res) => {
  if (tooMany(req.user.id))
    throw new BadInput("That's a lot of links at once. Wait a moment.", 429);

  let url;
  try {
    url = new URL(String(req.body?.url ?? "").trim());
  } catch {
    throw new BadInput("Paste a Google or Apple Maps link.");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !allowedHost(url.hostname))
    throw new BadInput(
      "That isn't a Google or Apple Maps link. Paste one of those, or the coordinates.",
    );

  // Maybe the numbers are already in the link they pasted
  let found = coordsFrom(url.href);
  let current = url;

  // Otherwise follow where the short link goes (staying on Google/Apple),
  // reading the numbers from each step, then from the final page
  for (let hop = 0; hop < 6 && !found; hop++) {
    let answer;
    try {
      answer = await fetch(current.href, {
        redirect: "manual",
        headers: {
          // Some share links only redirect for a normal-looking browser
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(8 * 1000),
      });
    } catch {
      throw new BadInput(
        "Couldn't open that link. Check it, or paste the coordinates instead.",
        502,
      );
    }

    // A redirect: check where to, then carry on
    const location = answer.headers.get("location");
    if (answer.status >= 300 && answer.status < 400 && location) {
      let next;
      try {
        next = new URL(location, current);
      } catch {
        break;
      }
      if (next.protocol !== "https:" || !allowedHost(next.hostname)) break;
      found = coordsFrom(next.href);
      current = next;
      continue;
    }

    // The final page: read a little of it and look for the numbers
    if (answer.ok) found = coordsFrom(await readCapped(answer, 400_000));
    break;
  }

  if (!found)
    throw new BadInput(
      "Couldn't find the place in that link. Open it and copy the coordinates from the map, or drop a pin and copy those.",
      422,
    );
  res.json(found);
});
