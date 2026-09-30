import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import { pushStatus, turnOffPush, turnOnPush, whyNoPush } from "../push";

// The switch at the bottom of the notifications panel: turns desktop/phone
// notifications on or off for this browser. Each computer or phone is
// switched on separately.
export default function PushToggle() {
  const [status, setStatus] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    pushStatus().then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (status === "on") await turnOffPush();
      else await turnOnPush();
    } catch (err) {
      setError(err.message);
    }
    setStatus(await pushStatus());
    setBusy(false);
  }

  if (status === "checking") return null;

  if (status === "unsupported") {
    return (
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        {whyNoPush()}
      </p>
    );
  }

  const on = status === "on";
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-center gap-3">
        {on ? (
          <BellRing className="h-4 w-4 shrink-0 text-brand" />
        ) : (
          <BellOff className="h-4 w-4 shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Desktop notifications
          </span>
          <span className="block text-xs text-muted">
            {on
              ? "On for this browser"
              : status === "blocked"
                ? "Blocked in this browser's settings"
                : "Pop-ups even when Uplink is closed"}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Desktop notifications"
          disabled={busy}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition active:scale-[0.95] disabled:cursor-wait disabled:opacity-60 ${
            on ? "bg-brand" : "bg-line"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              on ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
