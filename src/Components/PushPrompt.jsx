import { useEffect, useState } from "react";
import { BellRing, Share, X } from "lucide-react";
import { needsHomeScreen, pushStatus, turnOnPush } from "../push";
import { primaryButton, secondaryButton } from "./formStyles";
import Droplets from "./Droplets";

// A small card that asks to turn on desktop/phone notifications, a few
// seconds after opening Uplink in a browser where they're not on yet.
// Browsers only show their "Allow notifications?" question right after a
// tap, so this card asks first, and "Turn on" brings up the browser's
// question. "Not now" hides it for a week. It never shows if they're
// already on, or blocked (said no in the browser before).
// Either way, the switch in the bell's panel (PushToggle.jsx) turns them
// on or off any time.
//
// On iPhone/iPad in Safari, notifications only work from the Home
// Screen, so it explains how to add Uplink there instead.

const HIDDEN_FOR = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "uplink-push-prompt-hidden-at";

function hiddenRecently() {
  try {
    const at = Number(localStorage.getItem(STORAGE_KEY));
    return Boolean(at) && Date.now() - at < HIDDEN_FOR;
  } catch {
    return false;
  }
}

function hideForAWeek() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Private browsing: it'll just ask again next time
  }
}

export default function PushPrompt() {
  // null = hidden, "ask", "homeScreen" or "done"
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (hiddenRecently()) return;
    let cancelled = false;
    // A moment after the page opens, so it doesn't jump at people
    const timer = setTimeout(async () => {
      if (needsHomeScreen()) {
        if (!cancelled) setMode("homeScreen");
        return;
      }
      const status = await pushStatus();
      // Only when they've never been asked ("default"), not "blocked"
      if (
        !cancelled &&
        status === "off" &&
        window.Notification?.permission === "default"
      )
        setMode("ask");
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (mode !== "done") return;
    const timer = setTimeout(() => setMode(null), 5000);
    return () => clearTimeout(timer);
  }, [mode]);

  if (!mode) return null;

  function notNow() {
    hideForAWeek();
    setMode(null);
  }

  async function turnOn() {
    setBusy(true);
    setError("");
    try {
      await turnOnPush();
      setMode("done");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="animate-rise-in fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 rounded-2xl border border-line bg-white p-4 shadow-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          {mode === "done" ? (
            <>
              <p className="font-semibold">Notifications are on</p>
              <p className="mt-0.5 text-sm text-muted">
                Turn them off any time with the switch in the bell menu.
              </p>
            </>
          ) : mode === "homeScreen" ? (
            <>
              <p className="font-semibold">Get notifications on this phone</p>
              <p className="mt-0.5 text-sm text-muted">
                Tap <Share className="inline h-4 w-4 align-text-bottom" />{" "}
                Share, then <strong>Add to Home Screen</strong>, and open Uplink
                from there. It then works like an app, with notifications.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Turn on notifications?</p>
              <p className="mt-0.5 text-sm text-muted">
                Get a pop-up for new tickets, replies and anything assigned to
                you, even when Uplink is closed.
              </p>
            </>
          )}
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
        <button
          type="button"
          onClick={mode === "done" ? () => setMode(null) : notNow}
          aria-label="Close"
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-line/60 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {mode === "ask" && (
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={notNow} className={secondaryButton}>
            Not now
          </button>
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className={`${primaryButton} flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60`}
          >
            {busy && <Droplets className="h-4 w-4" />}
            Turn on
          </button>
        </div>
      )}
      {mode === "homeScreen" && (
        <div className="mt-4 flex">
          <button type="button" onClick={notNow} className={secondaryButton}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
