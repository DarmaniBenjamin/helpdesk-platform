import { useCallback, useEffect, useState } from "react";
import {
  AlarmClock,
  CircleCheck,
  Crosshair,
  MapPin,
  Navigation,
} from "lucide-react";
import Droplets from "./Droplets";
import { JOB_KINDS } from "./jobKinds";
import { api } from "../api";
import { currentPosition, directionsLink } from "../location";
import useData from "../useData";

// "It's time": when one of your jobs starts, this covers the screen until
// you answer it (and the phone buzzes, on Android). The server also sends
// an urgent notification every 2 minutes until you do (server/src/jobs.js).
//   I'm here   stops the alert. If the customer has no location saved
//              yet, it then asks to save where you're standing as theirs,
//              so next time anyone can get directions there.
//   Snooze     back in 5 minutes
//   Dismiss    stops the alert
// Checked every 30 seconds, when the app comes back to the front, and
// when an "It's time" notification arrives.

const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

export default function JobAlert() {
  const { notifications, jobsVersion, updateCustomer } = useData();
  const [jobs, setJobs] = useState([]);
  const [snoozed, setSnoozed] = useState({}); // job id -> until (ms)
  const [now, setNow] = useState(() => Date.now());
  const [step, setStep] = useState("alert"); // alert, location, saved
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api("/jobs/now")
      .then(setJobs)
      .catch(() => {});
  }, []);

  // Every 30 seconds, and when the app comes back to the front
  useEffect(() => {
    load();
    const tick = setInterval(() => {
      setNow(Date.now());
      load();
    }, 30 * 1000);
    const onShow = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        load();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  // A new "It's time" notification, or a job changed: look again
  const latestAlert = notifications.find((n) => n.kind === "jobNow")?.id;
  useEffect(() => {
    if (latestAlert || jobsVersion) load();
  }, [latestAlert, jobsVersion, load]);

  const job = jobs.find((j) => !(snoozed[j.id] > now));

  // Buzz when a new one shows (Android phones; iPhones don't allow it)
  useEffect(() => {
    if (job) navigator.vibrate?.([500, 250, 500, 250, 500]);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null;
  const Icon = JOB_KINDS[job.kind]?.icon ?? MapPin;

  function close() {
    setJobs((list) => list.filter((j) => j.id !== job.id));
    setStep("alert");
    setError("");
    setBusy("");
  }

  async function answer(snooze = 0) {
    setBusy(snooze ? "snooze" : "answer");
    setError("");
    try {
      await api(`/jobs/${job.id}/ack`, { method: "POST", body: { snooze } });
      if (snooze) {
        setSnoozed((s) => ({ ...s, [job.id]: Date.now() + snooze * 60000 }));
        setBusy("");
      } else close();
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function imHere() {
    if (job.customerId && !job.place) {
      setStep("location");
      return;
    }
    await answer();
  }

  async function saveLocation() {
    setBusy("location");
    setError("");
    try {
      const pos = await currentPosition();
      await updateCustomer(job.customerId, {
        location: { lat: pos.lat, lng: pos.lng, note: "" },
      });
      await api(`/jobs/${job.id}/ack`, { method: "POST", body: {} });
      setStep("saved");
      setBusy("");
      setTimeout(close, 2500);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  const big =
    "flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-base font-medium transition active:scale-[0.98] disabled:opacity-60";

  return (
    <div className="fixed inset-0 z-70 flex items-end justify-center bg-ink/60 p-3 backdrop-blur-sm sm:items-center">
      <div
        role="alertdialog"
        aria-labelledby="job-alert-title"
        className="animate-rise-in w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
      >
        {step === "saved" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CircleCheck className="h-12 w-12 text-brand" />
            <p className="text-lg font-semibold">Location saved</p>
            <p className="text-sm text-muted">
              Next time, anyone can get directions to {job.customerName}.
            </p>
          </div>
        ) : step === "location" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Crosshair className="h-6 w-6" />
              </span>
              <div>
                <p className="text-lg font-semibold">
                  Save this place for {job.customerName}?
                </p>
                <p className="text-sm text-muted">
                  There's no location saved for them yet. If you're at their
                  place now, save it so the team can find it next time.
                </p>
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="button"
              onClick={saveLocation}
              disabled={Boolean(busy)}
              className={`${big} bg-brand text-white hover:bg-brand/90`}
            >
              {busy === "location" ? (
                <Droplets className="h-5 w-5" />
              ) : (
                <Crosshair className="h-5 w-5" />
              )}
              Save my location
            </button>
            <button
              type="button"
              onClick={() => answer()}
              disabled={Boolean(busy)}
              className={`${big} border border-line text-muted hover:text-ink`}
            >
              Not now
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-400/30" />
                <AlarmClock className="relative h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-500">It's time</p>
                <p
                  id="job-alert-title"
                  className="text-xl font-semibold leading-tight"
                >
                  {job.title}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Icon className="h-4 w-4 shrink-0" />
                  {JOB_KINDS[job.kind]?.label} · {fmtTime(job.start)}–
                  {fmtTime(job.end)}
                </p>
                {(job.customerName || job.location) && (
                  <p className="text-sm text-muted">
                    {[job.customerName, job.location || job.place?.note]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex flex-col gap-2">
              {job.place && (
                <a
                  href={directionsLink(job.place)}
                  target="_blank"
                  rel="noreferrer"
                  className={`${big} border border-brand/30 text-brand hover:bg-brand/5`}
                >
                  <Navigation className="h-5 w-5" />
                  Directions
                </a>
              )}
              <button
                type="button"
                onClick={imHere}
                disabled={Boolean(busy)}
                className={`${big} bg-brand text-white hover:bg-brand/90`}
              >
                {busy === "answer" ? (
                  <Droplets className="h-5 w-5" />
                ) : (
                  <CircleCheck className="h-5 w-5" />
                )}
                {job.kind === "onsite" ? "I'm here" : "On it"}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => answer(5)}
                  disabled={Boolean(busy)}
                  className={`${big} border border-line hover:bg-page`}
                >
                  Snooze 5 min
                </button>
                <button
                  type="button"
                  onClick={() => answer()}
                  disabled={Boolean(busy)}
                  className={`${big} border border-line text-muted hover:text-ink`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
