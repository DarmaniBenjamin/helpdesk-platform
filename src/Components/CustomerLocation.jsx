import { useState } from "react";
import {
  Crosshair,
  ExternalLink,
  MapPin,
  Navigation,
  PenLine,
  Trash2,
} from "lucide-react";
import Droplets from "./Droplets";
import { inputClass, labelClass, secondaryButton } from "./formStyles";
import {
  currentPosition,
  directionsLink,
  mapsLink,
  parseLocation,
} from "../location";

// A customer's location, on their page: open it in the phone's maps app
// (or get directions), save where you're standing right now ("I'm at the
// customer"), or type it in: paste a maps link or coordinates, with a
// note like "blue gate, upstairs". onSave(location or null) saves it and
// returns false if it didn't work (the page shows why).
export default function CustomerLocation({ customer, onSave }) {
  const place = customer.location;
  const [mode, setMode] = useState(null); // null, "manual", "confirmRemove"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState(place?.note ?? "");

  async function useHere() {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const pos = await currentPosition();
      const ok = await onSave({ lat: pos.lat, lng: pos.lng, note });
      if (ok)
        setDone(
          `Saved where you are now (accurate to about ${pos.accuracy} m).`,
        );
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function saveManual(e) {
    e.preventDefault();
    setError("");
    setDone("");
    const at = link.trim() ? parseLocation(link) : place;
    if (!at) {
      setError(
        /goo\.gl|maps\.app/i.test(link)
          ? "Short share links don't include the place itself. Open the link, then copy the numbers from the address bar, or press and hold the spot on the map to copy its coordinates."
          : "That doesn't look like a location. Paste a Google or Apple Maps link, or coordinates like 12.0561, -61.7486.",
      );
      return;
    }
    setBusy(true);
    const ok = await onSave({ lat: at.lat, lng: at.lng, note });
    setBusy(false);
    if (ok) {
      setMode(null);
      setLink("");
      setDone("Location saved.");
    }
  }

  const iconLink =
    "flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:border-brand/40 hover:text-brand sm:flex-none";

  return (
    <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">Location</h2>

      {place ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <div className="min-w-0">
              {place.note && <p className="font-medium">{place.note}</p>}
              <p className="text-xs text-muted">
                {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                {place.by ? ` · saved by ${place.by}` : ""}
                {place.at
                  ? ` on ${new Date(place.at).toLocaleDateString("en-US", { dateStyle: "medium" })}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={directionsLink(place)}
              target="_blank"
              rel="noreferrer"
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:bg-brand/90 sm:flex-none"
            >
              <Navigation className="h-4 w-4" />
              Directions
            </a>
            <a
              href={mapsLink(place, customer.name)}
              target="_blank"
              rel="noreferrer"
              className={iconLink}
            >
              <ExternalLink className="h-4 w-4" />
              Open in Maps
            </a>
          </div>
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted">
          No location saved yet. When you're at the customer, tap{" "}
          <strong>I'm here: save it</strong>. Or type it in if you know it.
        </p>
      )}

      {mode === "manual" ? (
        <form onSubmit={saveManual} className="mt-3 flex flex-col gap-3">
          <label className={labelClass}>
            <span>
              Maps link or coordinates
              {place && (
                <span className="font-normal text-muted">
                  {" "}
                  (empty = keep the pin)
                </span>
              )}
            </span>
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError("");
              }}
              placeholder="12.0561, -61.7486 or a maps link"
              autoCapitalize="none"
              spellCheck="false"
              className={inputClass}
            />
          </label>
          <p className="text-xs text-muted">
            In Google Maps or Apple Maps, press and hold the spot to drop a pin,
            then copy its coordinates (or Share → Copy link) and paste them
            here.
          </p>
          <label className={labelClass}>
            <span>
              Note <span className="font-normal text-muted">(optional)</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Blue gate, upstairs office"
              className={inputClass}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60 sm:flex-none"
            >
              {busy && <Droplets className="h-4 w-4" />}
              Save location
            </button>
          </div>
        </form>
      ) : mode === "confirmRemove" ? (
        <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
          <p className="flex-1">Remove the saved location?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className="h-9 flex-1 cursor-pointer rounded-lg border border-line px-3 sm:flex-none"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await onSave(null)) {
                  setMode(null);
                  setNote("");
                }
              }}
              className="h-9 flex-1 cursor-pointer rounded-lg bg-red-500 px-3 font-medium text-white sm:flex-none"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={useHere}
            disabled={busy}
            className={`${iconLink} cursor-pointer disabled:opacity-60`}
          >
            {busy ? (
              <Droplets className="h-4 w-4" />
            ) : (
              <Crosshair className="h-4 w-4" />
            )}
            {place ? "I'm here: update it" : "I'm here: save it"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("manual");
              setError("");
              setDone("");
            }}
            className={`${iconLink} cursor-pointer`}
          >
            <PenLine className="h-4 w-4" />
            {place ? "Change" : "Enter it"}
          </button>
          {place && (
            <button
              type="button"
              onClick={() => setMode("confirmRemove")}
              aria-label="Remove location"
              title="Remove location"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {done && <p className="mt-2 text-sm text-brand">{done}</p>}
    </div>
  );
}
