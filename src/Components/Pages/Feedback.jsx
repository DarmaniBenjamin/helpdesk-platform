import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { CircleAlert, CircleCheck, Star } from "lucide-react";
import AuthShell from "../AuthShell";
import { inputClass } from "../formStyles";
import { api } from "../../api";
import Droplets from "../Droplets";

// The page the "How did we do?" email links to (/feedback/<token>): the
// customer rates their resolved request 1 to 5 stars, with a comment if
// they like. No sign-in: the link itself only works for that one ticket
// (server/src/notices.js). Each ticket can be rated once.
export default function Feedback() {
  const { token } = useParams();
  const [state, setState] = useState("loading"); // "loading", "ready", "invalid"
  const [info, setInfo] = useState(null); // { ticketId, subject, name, feedback }
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api(`/feedback/${token}`)
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function send(e) {
    e.preventDefault();
    if (!stars || busy) return;
    setBusy(true);
    setError("");
    try {
      setInfo(
        await api(`/feedback/${token}`, {
          method: "POST",
          body: { rating: stars, comment },
        }),
      );
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  if (state === "loading") {
    return (
      <AuthShell title="Feedback">
        <div className="flex justify-center py-10">
          <Droplets className="h-10 w-10 text-brand" />
        </div>
      </AuthShell>
    );
  }

  if (state === "invalid") {
    return (
      <AuthShell title="Feedback">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleAlert className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold">This link doesn't work</h1>
          <p className="text-sm text-muted">
            Check that the whole link from the email was opened. If it still
            doesn't work, just reply to the email instead.
          </p>
        </div>
      </AuthShell>
    );
  }

  // Already rated (just now, or before)
  if (info.feedback) {
    return (
      <AuthShell title="Feedback">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <CircleCheck className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold">Thank you, {info.name}!</h1>
          <div
            className="flex gap-1"
            aria-label={`${info.feedback.rating} out of 5 stars`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                className={`h-6 w-6 ${
                  n <= info.feedback.rating
                    ? "fill-amber-400 text-amber-400"
                    : "text-line"
                }`}
              />
            ))}
          </div>
          {info.feedback.comment && (
            <p className="text-sm text-muted">"{info.feedback.comment}"</p>
          )}
          <p className="text-sm text-muted">
            Your feedback on request #{info.ticketId} helps us get better.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Feedback">
      <h1 className="text-2xl font-semibold">How did we do?</h1>
      <p className="mt-1 text-sm text-muted">
        Hi {info.name}, how was our help with request #{info.ticketId}:{" "}
        <span className="font-medium text-ink">{info.subject}</span>?
      </p>

      <form onSubmit={send} className="mt-6 flex flex-col gap-4">
        <div
          className="flex justify-center gap-2"
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => setStars(n)}
              onMouseEnter={() => setHover(n)}
              className="cursor-pointer rounded p-1 transition active:scale-90"
            >
              <Star
                className={`h-10 w-10 transition ${
                  n <= (hover || stars)
                    ? "fill-amber-400 text-amber-400"
                    : "text-line"
                }`}
              />
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-muted">
          {
            ["Tap a star", "Poor", "Not great", "OK", "Good", "Excellent"][
              hover || stars
            ]
          }
        </p>

        {stars > 0 && (
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you'd like to add? (optional)"
            className={`${inputClass} h-auto resize-y py-2.5`}
          />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={!stars || busy}
          className="h-11 w-full cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send feedback"}
        </button>
      </form>
    </AuthShell>
  );
}
