// Customers' locations: opening them in the phone's own maps app, reading
// a location from a pasted maps link or coordinates, and getting this
// phone's current position ("I'm here").

const isApple = () =>
  /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) &&
  (navigator.maxTouchPoints > 1 || /iphone|ipod/i.test(navigator.userAgent));
const isAndroid = () => /android/i.test(navigator.userAgent);

// A link that opens the location in the default maps app: Apple Maps on
// iPhone/iPad, the default maps app (usually Google Maps) on Android,
// and Google Maps in the browser on computers
export function mapsLink({ lat, lng }, label = "") {
  const where = `${lat},${lng}`;
  if (isApple())
    return `https://maps.apple.com/?ll=${where}&q=${encodeURIComponent(label || where)}`;
  if (isAndroid())
    return `geo:${where}?q=${where}${label ? `(${encodeURIComponent(label)})` : ""}`;
  return `https://www.google.com/maps/search/?api=1&query=${where}`;
}

// Directions from here, in the maps app
export function directionsLink({ lat, lng }) {
  const where = `${lat},${lng}`;
  if (isApple()) return `https://maps.apple.com/?daddr=${where}`;
  if (isAndroid()) return `google.navigation:q=${where}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${where}`;
}

// { lat, lng } if they're real coordinates, else null (rejects 0,0 too)
function coords(lat, lng) {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    (lat || lng)
    ? { lat, lng }
    : null;
}

// A number with an optional compass letter: "61.40 W" → -61.40, "12.06 N"
// → 12.06. With no letter, the sign it already has is kept.
function signed(num, dir) {
  const d = (dir || "").toUpperCase();
  if (d === "S" || d === "W") return -Math.abs(Number(num));
  if (d === "N" || d === "E") return Math.abs(Number(num));
  return Number(num);
}

// Coordinates from what someone pasted. Handles:
//   - "12.0561, -61.7486"              plain decimal
//   - "12.0561° N, 61.7486° W"         with a degree sign and compass letter
//   - 12°03'22"N 61°44'55"W            degrees, minutes, seconds
//   - geo:12.0561,-61.7486             a geo link
//   - a Google/Apple Maps link that has the numbers in it
//     (…/@12.05,-61.74, ?q=…, ?ll=…, ?coordinate=…, !3d12.05!4d-61.74)
// A short share link has no numbers in it: looksLikeMapsLink() says when to
// hand it to the server to open instead. Returns { lat, lng } or null.
export function parseLocation(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  let t;
  try {
    t = decodeURIComponent(raw);
  } catch {
    t = raw;
  }

  // 1. Numbers inside a maps or geo link
  const inLink = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // Google place
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // …/@lat,lng,zoom
    /[?&](?:q|ll|query|daddr|destination|sll|center|coordinate|near)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  ];
  for (const p of inLink) {
    const m = t.match(p);
    if (m) {
      const at = coords(Number(m[1]), Number(m[2]));
      if (at) return at;
    }
  }
  // It's a link but the numbers weren't in it (a short share link): don't
  // guess from stray digits — the server opens it instead
  if (looksLikeMapsLink(t)) return null;

  // 2. Degrees, minutes, seconds: 12°03'48.0"N 61°24'13.7"W
  const dms = t.match(
    /(\d+)\s*[°\s]\s*(\d+)\s*['’\s]\s*([\d.]+)\s*["”\s]*\s*([NSEW])[,\s]+\s*(\d+)\s*[°\s]\s*(\d+)\s*['’\s]\s*([\d.]+)\s*["”\s]*\s*([NSEW])/i,
  );
  if (dms) {
    const dec = (deg, min, sec, dir) =>
      signed(Number(deg) + Number(min) / 60 + Number(sec) / 3600, dir);
    const at = coords(
      dec(dms[1], dms[2], dms[3], dms[4]),
      dec(dms[5], dms[6], dms[7], dms[8]),
    );
    if (at) return at;
  }

  // 3. A decimal pair, each with an optional degree sign and compass letter
  const dec = t.match(
    /(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?[,\s]+\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?/i,
  );
  if (dec) {
    const at = coords(signed(dec[1], dec[2]), signed(dec[3], dec[4]));
    if (at) return at;
  }
  return null;
}

// Does this look like a maps link to hand to the server to open — even if
// it's a short share link, or is missing the https:// in front?
export function looksLikeMapsLink(text) {
  const t = String(text ?? "").trim();
  return (
    /^https?:\/\//i.test(t) ||
    /(?:^|\/\/|\.)(?:goo\.gl|maps\.app\.goo\.gl|maps\.apple\.com|maps\.google\.|g\.co)\b/i.test(
      t,
    ) ||
    /\bgoogle\.[a-z.]+\/maps\b/i.test(t)
  );
}

// This phone's position, as exact as it can get (GPS). The browser asks
// "Allow location?" the first time. Throws an error in plain words.
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("This device can't share its location."));
    if (!window.isSecureContext)
      return reject(
        new Error("Location only works on the secure (https) address."),
      );
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        }),
      (err) =>
        reject(
          new Error(
            err.code === 1
              ? "Location is blocked for this site. Allow it in the browser's settings and try again."
              : err.code === 3
                ? "Getting the location took too long. Step outside or near a window and try again."
                : "Couldn't get the location. Make sure location is on for this phone.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}
