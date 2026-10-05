import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  Inbox,
  Megaphone,
  TicketPlus,
  UserRoundX,
} from "lucide-react";
import Droplets from "../Droplets";
import { api } from "../../api";
import { timeAgo } from "../../data";
import useData from "../../useData";

// Email review: emails that came in but didn't become tickets by
// themselves, because they look like a newsletter or automatic notice
// ("We've updated our terms"), or they're from someone who isn't a
// customer on file (server/src/email.js). Tick the ones that should be
// tickets and make them all at once, or ignore the rest. "Always ignore"
// stops a sender (or a whole company's domain) from landing here again.
// Anything left here is cleared out after 30 days.

const REASONS = {
  bulk: { label: "Newsletter or notice", icon: Megaphone },
  unknown: { label: "Not a customer", icon: UserRoundX },
};

export default function EmailReview() {
  const { setHeldCount } = useData();
  const [held, setHeld] = useState(null); // null = loading
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null); // { tone, text }

  function show(list) {
    setHeld(list);
    setHeldCount(list.length);
    setPicked(
      (p) => new Set([...p].filter((id) => list.some((h) => h.id === id))),
    );
  }

  useEffect(() => {
    api("/email-review")
      .then(show)
      .catch((err) => {
        setHeld([]);
        setMessage({ tone: "error", text: err.message });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPicked = held?.length > 0 && picked.size === held.length;
  const toggle = (id) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function act(kind, always = null) {
    const ids = [...picked];
    if (!ids.length) return;
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "accept") {
        const r = await api("/email-review/accept", {
          method: "POST",
          body: { ids },
        });
        show(r.held);
        setMessage({
          tone: "ok",
          text: `${r.made} ticket${r.made === 1 ? "" : "s"} made. They're in the Inbox.`,
        });
      } else {
        const r = await api("/email-review/ignore", {
          method: "POST",
          body: { ids, always },
        });
        show(r.held);
        setMessage({
          tone: "ok",
          text: always
            ? `Ignored, and those ${always === "sender" ? "senders" : "domains"} won't come here again.`
            : "Ignored.",
        });
      }
    } catch (err) {
      setMessage({ tone: "error", text: err.message });
    }
    setBusy("");
  }

  const actionButton =
    "flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div>
        <Link
          to="/inbox"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Inbox
        </Link>
        <h1 className="text-2xl font-semibold sm:text-3xl">Email review</h1>
        <p className="mt-1 text-sm text-muted">
          Emails that didn't become tickets by themselves. Tick the ones that
          should, and make them tickets all at once. Ignore the rest, or always
          ignore a sender so they don't come here again.
        </p>
      </div>

      {/* Actions for the ticked ones */}
      {held?.length > 0 && (
        <div className="sticky top-16 z-10 flex flex-col gap-2 rounded-xl border border-line bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() =>
                setPicked(
                  allPicked ? new Set() : new Set(held.map((h) => h.id)),
                )
              }
              className="h-4 w-4 cursor-pointer accent-brand"
            />
            {picked.size ? `${picked.size} ticked` : "Tick all"}
          </label>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button
              type="button"
              disabled={!picked.size || Boolean(busy)}
              onClick={() => act("accept")}
              className={`${actionButton} bg-brand font-medium text-white hover:bg-brand/90`}
            >
              {busy === "accept" ? (
                <Droplets className="h-4 w-4" />
              ) : (
                <TicketPlus className="h-4 w-4" />
              )}
              Make tickets
            </button>
            <button
              type="button"
              disabled={!picked.size || Boolean(busy)}
              onClick={() => act("ignore")}
              className={`${actionButton} border border-line hover:bg-page`}
            >
              {busy === "ignore" && <Droplets className="h-4 w-4" />}
              Ignore
            </button>
            <button
              type="button"
              disabled={!picked.size || Boolean(busy)}
              onClick={() => act("ignore", "sender")}
              className={`${actionButton} border border-line text-red-500 hover:bg-red-50`}
            >
              <Ban className="h-4 w-4" />
              Always ignore sender
            </button>
            <button
              type="button"
              disabled={!picked.size || Boolean(busy)}
              onClick={() => act("ignore", "domain")}
              className={`${actionButton} border border-line text-red-500 hover:bg-red-50`}
            >
              <Ban className="h-4 w-4" />
              Always ignore domain
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          className={`flex items-start gap-2 text-sm ${message.tone === "ok" ? "text-brand" : "text-red-500"}`}
        >
          {message.tone === "ok" && (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {message.text}
        </p>
      )}

      {held === null ? (
        <div className="flex justify-center py-16">
          <Droplets className="h-10 w-10 text-brand" />
        </div>
      ) : held.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white px-4 py-14 text-center">
          <Inbox className="h-8 w-8 text-muted" />
          <p className="font-medium">Nothing to review</p>
          <p className="text-sm text-muted">
            Emails that might not be tickets show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {held.map((h) => {
            const reason = REASONS[h.reason] ?? REASONS.bulk;
            const Icon = reason.icon;
            return (
              <li key={h.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-page">
                  <input
                    type="checkbox"
                    checked={picked.has(h.id)}
                    onChange={() => toggle(h.id)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-medium">
                        {h.name || h.from}
                      </p>
                      {h.name && (
                        <p className="truncate text-xs text-muted">{h.from}</p>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-muted">
                        {timeAgo(h.at)}
                      </span>
                    </div>
                    <p className="truncate text-sm">{h.subject}</p>
                    {h.snippet && (
                      <p className="line-clamp-1 text-xs text-muted">
                        {h.snippet}
                      </p>
                    )}
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[11px] text-muted">
                      <Icon className="h-3 w-3" />
                      {reason.label}
                    </span>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
