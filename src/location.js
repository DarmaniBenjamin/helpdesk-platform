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

// Coordinates from what someone pasted: "12.0561, -61.7486", or a
// Google Maps / Apple Maps link (…/@12.05,-61.74,17z, ?q=12.05,-61.74,
// ?ll=…, !3d12.05!4d-61.74). Returns { lat, lng } or null.
export function parseLocation(text) {
  const t = decodeURIComponent(String(text ?? "").trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // Google Maps place links
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // …/@lat,lng,zoom
    /[?&](?:q|ll|query|daddr|destination|sll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/, // plain "lat, lng"
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng))
        return { lat, lng };
    }
  }
  return null;
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
