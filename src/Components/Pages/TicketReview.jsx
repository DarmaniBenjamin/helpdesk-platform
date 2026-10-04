import { useState } from "react";
import { useNavigate } from "react-router";
import {
  ClipboardCheck,
  Clock,
  CircleCheck,
  Star,
  Inbox as InboxIcon,
  UserX,
} from "lucide-react";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import PriorityBadge from "../PriorityBadge";
import { inputClass } from "../formStyles";
import useData from "../../useData";
import {
  AGENTS,
  DEPARTMENTS,
  DAY,
  findAgent,
  findDepartment,
  isDone,
  timeAgo,
} from "../../data";

// A ticket nobody has touched in this many days gets flagged
const STALE_DAYS = 2;

const PERIODS = {
  week: { label: "Last 7 days", days: 7 },
  month: { label: "Last 30 days", days: 30 },
  all: { label: "All time", days: null },
};

const PAGE_SIZE = 20;

// 45 -> "45m", 300 -> "5h", 3000 -> "2d 2h"
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

// Who finished the ticket: whoever last set it to Resolved or Closed,
// or else the person it was assigned to
// (The list of tickets says who, as closedBy. A ticket that's been
// opened also has its conversation, with the history lines in it.)
function closedBy(ticket) {
  const event = [...(ticket.messages ?? [])]
    .reverse()
    .find(
      (m) =>
        m.kind === "event" &&
        /changed status to (Resolved|Closed)/.test(m.body),
    );
  return (
    event?.author ??
    ticket.closedBy ??
    findAgent(ticket.assignee)?.name ??
    "Unknown"
  );
}

function isStale(ticket, now) {
  return now - ticket.updatedAt > STALE_DAYS * DAY;
}

// A small number box at the top
function Stat({ label, value, icon, tone = "brand", onClick, active }) {
  const Icon = icon;
  const tones = {
    brand: "bg-brand/10 text-brand",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99] ${
        active ? "border-brand" : "border-line"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-tight">
          {value}
        </span>
        <span className="block text-xs leading-snug text-muted">{label}</span>
      </span>
    </button>
  );
}

// One open ticket inside a person's group
function OpenRow({ ticket, now, onOpen }) {
  const stale = isStale(ticket, now);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-left transition hover:bg-brand/5 active:bg-brand/10"
      >
        <span className="min-w-0 flex-1 basis-60">
          <span className="block truncate text-sm font-medium">
            <span className="mr-2 text-muted">#{ticket.id}</span>
            {ticket.subject}
          </span>
          <span className="block truncate text-xs text-muted">
            {ticket.requester.name}
            {ticket.requester.company &&
              ` · ${ticket.requester.company}`} ·{" "}
            {findDepartment(ticket.department).name}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <span
            className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${
              stale ? "font-medium text-amber-600" : "text-muted"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            {stale
              ? `No update in ${Math.floor((now - ticket.updatedAt) / DAY)} days`
              : `Updated ${timeAgo(ticket.updatedAt)}`}
          </span>
        </span>
      </button>
    </li>
  );
}

// Everyone's open tickets, one group per person
function InProgress({ tickets, now, staleOnly, onOpen }) {
  // Each person with open tickets, plus "Unassigned" at the end
  const people = [
    ...AGENTS.map((a) => ({ id: a.id, name: a.name, title: a.title })),
    { id: null, name: "Unassigned", title: "Nobody has taken these yet" },
  ];
  const groups = people
    .map((person) => {
      const mine = tickets
        .filter((t) => (t.assignee ?? null) === person.id)
        .filter((t) => !staleOnly || isStale(t, now))
        // Longest without an update first: those need checking most
        .sort((a, b) => a.updatedAt - b.updatedAt);
      return { person, tickets: mine };
    })
    .filter((g) => g.tickets.length > 0)
    .sort((a, b) => b.tickets.length - a.tickets.length);

  if (groups.length === 0) {
    return (
      <Empty
        text={
          staleOnly
            ? `Nothing has gone ${STALE_DAYS}+ days without an update.`
            : "No open tickets here."
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      {groups.map(({ person, tickets: list }) => {
        const staleCount = list.filter((t) => isStale(t, now)).length;
        return (
          <section
            key={person.id ?? "unassigned"}
            className="overflow-hidden rounded-xl border border-line bg-white"
          >
            <header className="flex items-center gap-3 border-b border-line px-5 py-3">
              {person.id ? (
                <Avatar name={person.name} size="sm" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-page text-muted">
                  <UserX className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{person.name}</p>
                {person.title && (
                  <p className="truncate text-xs text-muted">{person.title}</p>
                )}
              </div>
              <div className="text-right text-xs">
                <p className="font-medium">{list.length} open</p>
                {staleCount > 0 && (
                  <p className="text-amber-600">{staleCount} need an update</p>
                )}
              </div>
            </header>
            <ul className="divide-y divide-line">
              {list.map((t) => (
                <OpenRow
                  key={t.id}
                  ticket={t}
                  now={now}
                  onOpen={() => onOpen(t)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// Finished tickets, with a "Reviewed" tick on each
function Closed({ tickets, onOpen, onReview }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = tickets.slice(0, visible);

  if (tickets.length === 0) {
    return <Empty text="No closed tickets match these filters." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {shown.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition hover:bg-brand/5"
          >
            <button
              type="button"
              onClick={() => onOpen(t)}
              className="min-w-0 flex-1 basis-60 cursor-pointer text-left"
            >
              <span className="block truncate text-sm font-medium hover:text-brand">
                <span className="mr-2 text-muted">#{t.id}</span>
                {t.subject}
              </span>
              <span className="block truncate text-xs text-muted">
                {t.requester.name} · Closed by {closedBy(t)}{" "}
                {timeAgo(t.resolvedAt)}
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <StatusBadge status={t.status} />
              <span className="whitespace-nowrap">
                Took {formatDuration(t.resolvedAt - t.createdAt)}
              </span>
              {t.feedback ? (
                <span
                  className="inline-flex items-center gap-0.5"
                  aria-label={`${t.feedback.rating} out of 5 stars`}
                  title={t.feedback.comment || undefined}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-3.5 w-3.5 ${
                        n <= t.feedback.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-line"
                      }`}
                    />
                  ))}
                </span>
              ) : (
                <span className="whitespace-nowrap">No rating</span>
              )}
            </div>

            {/* Tick it off once checked */}
            <button
              type="button"
              aria-pressed={Boolean(t.review)}
              onClick={() => onReview(t, !t.review)}
              title={
                t.review
                  ? `Reviewed by ${t.review.by} ${timeAgo(t.review.at)}. Click to undo.`
                  : "Mark as reviewed"
              }
              className={`ml-auto flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition active:scale-[0.97] ${
                t.review
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line text-muted hover:border-brand/40 hover:text-brand"
              }`}
            >
              <CircleCheck className="h-4 w-4" />
              {t.review ? "Reviewed" : "Mark reviewed"}
            </button>
          </li>
        ))}
      </ul>

      {tickets.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="h-11 cursor-pointer self-center rounded-lg border border-line bg-white px-6 text-sm font-medium transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
        >
          Show more ({tickets.length - visible} left)
        </button>
      )}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white px-6 py-14 text-center">
      <InboxIcon className="h-8 w-8 text-muted" />
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

// Ticket Review: where Admins check up on how tickets are going.
// "In progress" shows what each person is working on (and what's been
// sitting), "Closed" shows what's been finished, with a tick for each one
// that's been checked.
export default function TicketReview() {
  const navigate = useNavigate();
  const { tickets, markReviewed } = useData();

  const [tab, setTab] = useState("open"); // "open" or "closed"
  const [person, setPerson] = useState("any"); // "any", "none" or an agent id
  const [department, setDepartment] = useState("any");
  const [period, setPeriod] = useState("week");
  const [show, setShow] = useState("all"); // closed: "all", "todo", "done"
  const [staleOnly, setStaleOnly] = useState(false);

  // The time "now" is worked out once per visit, so the page doesn't
  // shift while you read it
  const [now] = useState(() => Date.now());

  // Filters that apply to both tabs
  const matchesFilters = (t) =>
    (department === "any" ||
      (department === "none" ? !t.department : t.department === department)) &&
    (person === "any" ||
      (person === "none" ? !t.assignee : t.assignee === person));

  const open = tickets.filter((t) => !isDone(t)).filter(matchesFilters);
  const since = PERIODS[period].days ? now - PERIODS[period].days * DAY : 0;
  const closedInPeriod = tickets
    .filter((t) => isDone(t) && t.resolvedAt >= since)
    .filter(matchesFilters)
    .sort((a, b) => b.resolvedAt - a.resolvedAt);
  const closed = closedInPeriod.filter(
    (t) => show === "all" || (show === "todo" ? !t.review : Boolean(t.review)),
  );

  const staleCount = open.filter((t) => isStale(t, now)).length;
  const notReviewed = closedInPeriod.filter((t) => !t.review).length;

  const openTicket = (t) => navigate(`/tickets/${t.id}`);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Ticket Review</h1>
        <p className="mt-1 text-sm text-muted">
          Check up on what each person is working on, and on what's been closed.
        </p>
      </div>

      {/* Numbers at a glance: each one jumps to the matching list */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="In progress"
          value={open.length}
          icon={ClipboardCheck}
          active={tab === "open" && !staleOnly}
          onClick={() => {
            setTab("open");
            setStaleOnly(false);
          }}
        />
        <Stat
          label={`No update in ${STALE_DAYS}+ days`}
          value={staleCount}
          icon={Clock}
          tone="amber"
          active={tab === "open" && staleOnly}
          onClick={() => {
            setTab("open");
            setStaleOnly(true);
          }}
        />
        <Stat
          label={`Closed · ${PERIODS[period].label.toLowerCase()}`}
          value={closedInPeriod.length}
          icon={CircleCheck}
          active={tab === "closed" && show === "all"}
          onClick={() => {
            setTab("closed");
            setShow("all");
          }}
        />
        <Stat
          label="Closed, not reviewed yet"
          value={notReviewed}
          icon={Star}
          tone="amber"
          active={tab === "closed" && show === "todo"}
          onClick={() => {
            setTab("closed");
            setShow("todo");
          }}
        />
      </div>

      {/* Tabs and filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex rounded-lg border border-line bg-white p-1 text-sm lg:w-fit">
          {[
            ["open", "In progress", open.length],
            ["closed", "Closed", closedInPeriod.length],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-1.5 transition active:scale-[0.97] lg:flex-none ${
                tab === id
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {label}
              <span className="text-xs opacity-70">{count}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className={`${inputClass} cursor-pointer sm:w-48`}
            aria-label="Person"
          >
            <option value="any">Everyone</option>
            <option value="none">Unassigned</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${inputClass} cursor-pointer sm:w-52`}
            aria-label="Department"
          >
            <option value="any">All departments</option>
            <option value="none">No team yet</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {tab === "open" ? (
            <label className="col-span-2 flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm sm:col-span-1">
              <input
                type="checkbox"
                checked={staleOnly}
                onChange={(e) => setStaleOnly(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-brand"
              />
              Only ones needing an update
            </label>
          ) : (
            <>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={`${inputClass} cursor-pointer sm:w-40`}
                aria-label="Closed within"
              >
                {Object.entries(PERIODS).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={show}
                onChange={(e) => setShow(e.target.value)}
                className={`${inputClass} cursor-pointer sm:w-40`}
                aria-label="Reviewed or not"
              >
                <option value="all">All</option>
                <option value="todo">Not reviewed</option>
                <option value="done">Reviewed</option>
              </select>
            </>
          )}
        </div>
      </div>

      {tab === "open" ? (
        <InProgress
          tickets={open}
          now={now}
          staleOnly={staleOnly}
          onOpen={openTicket}
        />
      ) : (
        <Closed
          key={`${period}-${show}-${person}-${department}`}
          tickets={closed}
          onOpen={openTicket}
          onReview={(t, reviewed) =>
            markReviewed(t.id, reviewed).catch((err) =>
              window.alert(err.message),
            )
          }
        />
      )}
    </div>
  );
}
