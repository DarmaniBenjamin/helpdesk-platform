import { useState } from "react";
import { Link } from "react-router";
import {
  ChevronRight,
  Inbox,
  MessageCircleReply,
  Plus,
  Search,
} from "lucide-react";
import PortalStatusBadge from "./PortalStatusBadge";
import { inputClass } from "../formStyles";
import { isDone, timeAgo } from "../../data";
import useData from "../../useData";

// The customer's list of their own requests (only theirs, never anyone else's)
export default function PortalHome() {
  const { me, tickets } = useData();
  const [tab, setTab] = useState("open");
  const [query, setQuery] = useState("");

  const mine = tickets.filter((t) => t.customerId === me.customerId);
  const open = mine.filter((t) => !isDone(t));
  const closed = mine.filter(isDone);
  const needsReply = open.filter((t) => t.status === "waiting");

  const text = query.trim().toLowerCase();
  const shown = (tab === "open" ? open : closed)
    .filter(
      (t) =>
        !text ||
        t.subject.toLowerCase().includes(text) ||
        String(t.id).includes(text.replace("#", "")),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Hi {me.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Here are your support requests.
          </p>
        </div>
        <Link
          to="/portal/new"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/30 active:translate-y-0 active:scale-[0.97] sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          New request
        </Link>
      </div>

      {needsReply.length > 0 && (
        <p className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <MessageCircleReply className="mt-0.5 h-4 w-4 shrink-0" />
          We're waiting for your reply on {needsReply.length} request
          {needsReply.length === 1 ? "" : "s"}.
        </p>
      )}

      {/* Tabs and search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-line bg-white p-1 text-sm">
          {[
            ["open", "Open", open.length],
            ["closed", "Closed", closed.length],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 cursor-pointer whitespace-nowrap rounded-md px-4 py-1.5 transition active:scale-[0.97] sm:flex-none ${
                tab === id
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your requests"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      {/* The list */}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-white px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Inbox className="h-5 w-5" />
          </span>
          <p className="font-medium">
            {text
              ? "Nothing matches your search."
              : tab === "open"
                ? "No open requests"
                : "No closed requests yet"}
          </p>
          {!text && tab === "open" && (
            <p className="text-sm text-muted">
              Need help with something?{" "}
              <Link to="/portal/new" className="font-medium text-brand">
                Send us a request
              </Link>
            </p>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((t) => (
            <li key={t.id}>
              <Link
                to={`/portal/tickets/${t.id}`}
                className={`group flex items-center gap-4 rounded-xl border bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md active:scale-[0.99] ${
                  t.status === "waiting" ? "border-amber-200" : "border-line"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PortalStatusBadge status={t.status} />
                    <span className="text-xs text-muted">#{t.id}</span>
                  </div>
                  <p className="mt-1.5 truncate font-medium">{t.subject}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Sent {timeAgo(t.createdAt)} · Updated {timeAgo(t.updatedAt)}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
