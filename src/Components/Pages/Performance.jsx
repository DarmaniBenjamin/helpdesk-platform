import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Download,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
  Star,
  MessageSquareText,
  ShieldCheck,
  Info,
  X,
} from "lucide-react";
import Card from "../Card";
import Avatar from "../Avatar";
import PriorityBadge from "../PriorityBadge";
import DueLabel from "../DueLabel";
import { inputClass } from "../formStyles";
import useData from "../../useData";
import {
  PRIORITIES,
  SLA_HOURS,
  AGENTS,
  HOUR,
  isDone,
  findAgent,
  findDepartment,
  timeAgo,
} from "../../data";

// ---------- Settings ----------

// The time ranges you can pick at the top of the page
const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

// A ticket counts as "due soon" when its deadline is this close
const AT_RISK_HOURS = 2;

// How many rows to show before "Show all" / "Show more"
const ATTENTION_LIMIT = 6;
const FEEDBACK_PAGE = 8;

// The rating filter buttons
const RATING_FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "positive", label: "Positive", test: (r) => r >= 4 },
  { id: "neutral", label: "Neutral", test: (r) => r === 3 },
  { id: "negative", label: "Negative", test: (r) => r <= 2 },
];

// Which ratings to show: one of the buttons above, or one star level ("stars-4")
function ratingTestFor(filter) {
  if (filter.startsWith("stars-")) {
    const stars = Number(filter.slice(6));
    return (r) => r === stars;
  }
  return RATING_FILTERS.find((f) => f.id === filter).test;
}

// Colors for "needs attention" reasons, worst first
const REASON_STYLES = {
  3: "bg-red-50 text-red-600 ring-red-200",
  2: "bg-orange-50 text-orange-600 ring-orange-200",
  1: "bg-amber-50 text-amber-700 ring-amber-200",
};

// ---------- Helpers ----------

// Midnight at the start of a day, `offset` days away from the day of `time`.
// Built from the calendar (not "minus 24 hours") so daylight saving can't shift it.
function dayStart(time, offset = 0) {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + offset,
  ).getTime();
}

// Is this time between `from` (included) and `to` (not included)?
function inRange(time, from, to) {
  return time != null && time >= from && time < to;
}

function average(numbers) {
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

// 5 of 20 -> 25 (null when there's nothing to count)
function percent(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 100);
}

// Change in percentage points (80% -> 85% = +5)
function pointChange(current, previous) {
  if (current === null || previous === null) return null;
  return current - previous;
}

// Change in average stars, to one decimal (4.1 -> 4.4 = +0.3)
function ratingChange(current, previous) {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}

// 1 -> "1 hour", 8 -> "8 hours", 72 -> "3 days"
function hoursText(hours) {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// "Sep 19 – Sep 25, 2026"
function rangeLabel(from, to) {
  const short = { month: "short", day: "numeric" };
  const start = new Date(from).toLocaleDateString("en-US", short);
  const end = new Date(to).toLocaleDateString("en-US", {
    ...short,
    year: "numeric",
  });
  return `${start} – ${end}`;
}

// Why an open ticket needs attention right now, or null if it's on track.
// level 3 = already overdue, 2 = first reply is late, 1 = deadline coming up
function attentionReason(ticket, now) {
  if (isDone(ticket)) return null;
  if (now > ticket.dueBy) return { level: 3, label: "Overdue" };
  if (!ticket.firstRespondedAt && now > ticket.firstResponseDue)
    return { level: 2, label: "No reply yet" };
  if (ticket.dueBy - now < AT_RISK_HOURS * HOUR)
    return { level: 1, label: "Due soon" };
  if (!ticket.firstRespondedAt && ticket.firstResponseDue - now < HOUR)
    return { level: 1, label: "Reply due soon" };
  return null;
}

// On-time rates and ratings for tickets between `from` and `to`
function slaStats(tickets, from, to) {
  const created = tickets.filter((t) => inRange(t.createdAt, from, to));
  const responded = created.filter((t) => t.firstRespondedAt);
  const resolved = tickets.filter((t) => inRange(t.resolvedAt, from, to));
  const late = resolved.filter((t) => t.resolvedAt > t.dueBy).length;
  const ratings = tickets
    .filter((t) => t.feedback && inRange(t.feedback.at, from, to))
    .map((t) => t.feedback.rating);

  return {
    created: created.length,
    resolved: resolved.length,
    late,
    responseOnTime: percent(
      responded.filter((t) => t.firstRespondedAt <= t.firstResponseDue).length,
      responded.length,
    ),
    resolvedOnTime: percent(resolved.length - late, resolved.length),
    ratingCount: ratings.length,
    avgRating: average(ratings),
    happy: percent(ratings.filter((r) => r >= 4).length, ratings.length),
  };
}

// Downloads rows as a spreadsheet file (CSV)
function downloadCsv(rows, filename) {
  // Wrap each value in quotes so commas inside text don't break the columns
  const csv = rows
    .map((row) =>
      row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  // "\uFEFF" at the start tells Excel the file is UTF-8, so letters like é show correctly
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Give the browser a moment to start the download before cleaning up
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Small pieces ----------

function StatCard({ label, value, note, warn, trend, unit = "", upIsGood }) {
  const hasTrend = trend !== null && trend !== undefined;
  const good = hasTrend && trend >= 0 === upIsGood;
  const TrendIcon = hasTrend && trend < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">{value}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {hasTrend && trend !== 0 && (
          <>
            <span
              className={`flex items-center gap-1 font-medium ${good ? "text-brand" : "text-red-500"}`}
            >
              <TrendIcon className="h-4 w-4" />
              {Math.abs(trend)}
              {unit}
            </span>
            <span className="text-muted">vs previous period</span>
          </>
        )}
        {hasTrend && trend === 0 && (
          <span className="text-muted">No change vs previous period</span>
        )}
        {!hasTrend && (
          <span
            className={`flex items-center gap-1 ${warn ? "font-medium text-red-500" : "text-muted"}`}
          >
            {warn && <TriangleAlert className="h-3.5 w-3.5" />}
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

// Five stars, filled up to `rating`
function Stars({ rating, size = "h-4 w-4" }) {
  return (
    <span
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${size} ${n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
        />
      ))}
    </span>
  );
}

// Green 90%+, amber 75%+, red below
function onTimeColor(value) {
  if (value === null) return { text: "text-muted", bar: "bg-slate-300" };
  if (value >= 90) return { text: "text-brand", bar: "bg-brand" };
  if (value >= 75) return { text: "text-amber-600", bar: "bg-amber-500" };
  return { text: "text-red-500", bar: "bg-red-500" };
}

function OnTimeValue({ value }) {
  if (value === null) return <span className="text-muted">No data</span>;
  return (
    <span className={`font-medium ${onTimeColor(value).text}`}>{value}%</span>
  );
}

// A label, the % and a bar filled to that %
function OnTimeBar({ label, value }) {
  const color = onTimeColor(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className={`font-medium ${color.text}`}>
          {value === null ? "No data" : `${value}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-page">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color.bar}`}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}

// One small number with a label under it
function MiniStat({ label, value, tone }) {
  const color =
    value > 0 && tone === "bad"
      ? "text-red-500"
      : value > 0 && tone === "warn"
        ? "text-amber-600"
        : "";
  return (
    <div>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function AgentCard({ agent, stats, onShowFeedback }) {
  const teams = agent.departments.map((id) => findDepartment(id).name);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={agent.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{agent.name}</p>
          <p className="truncate text-xs text-muted">{teams.join(", ")}</p>
        </div>
        <div className="shrink-0 text-right">
          {stats.avgRating === null ? (
            <p className="text-xs text-muted">No ratings</p>
          ) : (
            <>
              <p className="flex items-center justify-end gap-1 font-semibold">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {stats.avgRating.toFixed(1)}
              </p>
              <p className="text-xs text-muted">
                {stats.ratingCount} rating{stats.ratingCount === 1 ? "" : "s"}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <OnTimeBar
          label="First response on time"
          value={stats.responseOnTime}
        />
        <OnTimeBar label="Resolved on time" value={stats.resolvedOnTime} />
      </div>

      <div className="grid grid-cols-4 gap-2 rounded-lg bg-page p-3 text-center">
        <MiniStat label="Resolved" value={stats.resolved} />
        <MiniStat label="Late" value={stats.late} tone="bad" />
        <MiniStat label="Overdue" value={stats.overdueNow} tone="bad" />
        <MiniStat label="At risk" value={stats.atRisk} tone="warn" />
      </div>

      <button
        type="button"
        onClick={onShowFeedback}
        className="mt-auto flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
      >
        <MessageSquareText className="h-4 w-4" />
        See feedback ({stats.ratingCount})
      </button>
    </div>
  );
}

function FeedbackItem({ ticket }) {
  const { feedback, requester } = ticket;
  const agent = findAgent(ticket.assignee);

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <Stars rating={feedback.rating} />
        <span className="shrink-0 text-xs text-muted">
          {timeAgo(feedback.at)}
        </span>
      </div>
      {feedback.comment ? (
        <p className="text-sm leading-relaxed">"{feedback.comment}"</p>
      ) : (
        <p className="text-sm text-muted">No comment left</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {requester.name}
          {requester.company && `, ${requester.company}`}
        </span>
        <Link
          to={`/tickets/${ticket.id}`}
          className="font-medium text-brand hover:underline"
        >
          Ticket #{ticket.id}
        </Link>
        <span>Handled by {agent ? agent.name : "nobody"}</span>
      </div>
    </li>
  );
}

// ---------- The page ----------

export default function Performance() {
  const { tickets } = useData();

  // "Now" refreshes every minute, so "Due soon" and "Overdue" stay current
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const [days, setDays] = useState(30);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [agentFilter, setAgentFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [feedbackShown, setFeedbackShown] = useState(FEEDBACK_PAGE);
  const feedbackRef = useRef(null);

  // This period starts at midnight `days - 1` days ago and runs until now.
  // The previous period is the same length, just before it.
  const from = dayStart(now, -(days - 1));
  const previousFrom = dayStart(now, -(2 * days - 1));

  // Infinity as the end: anything that happens after the page opened still counts
  const current = slaStats(tickets, from, Infinity);
  const previous = slaStats(tickets, previousFrom, from);

  // Open tickets that need attention, worst and soonest first
  const attention = tickets
    .map((t) => ({ ticket: t, reason: attentionReason(t, now) }))
    .filter((a) => a.reason)
    .sort(
      (a, b) =>
        b.reason.level - a.reason.level || a.ticket.dueBy - b.ticket.dueBy,
    );
  const overdueNow = attention.filter((a) => a.reason.level === 3).length;
  const atRiskNow = attention.length - overdueNow;
  const attentionShown = showAllAttention
    ? attention
    : attention.slice(0, ATTENTION_LIMIT);

  // One scorecard per agent
  const agentCards = AGENTS.map((agent) => {
    const theirs = tickets.filter((t) => t.assignee === agent.id);
    const theirAttention = attention.filter(
      (a) => a.ticket.assignee === agent.id,
    );
    const overdue = theirAttention.filter((a) => a.reason.level === 3).length;
    return {
      agent,
      stats: {
        ...slaStats(theirs, from, Infinity),
        overdueNow: overdue,
        atRisk: theirAttention.length - overdue,
      },
    };
  });

  // Targets and results per priority, Urgent first
  const priorityRows = Object.keys(PRIORITIES)
    .map(Number)
    .reverse()
    .map((p) => ({
      priority: p,
      ...SLA_HOURS[p],
      ...slaStats(
        tickets.filter((t) => t.priority === p),
        from,
        Infinity,
      ),
    }));

  // Customer feedback in this period, newest first, for the chosen agent
  const agentFeedback = tickets
    .filter(
      (t) =>
        t.feedback &&
        inRange(t.feedback.at, from, Infinity) &&
        (agentFilter === "all" || t.assignee === agentFilter),
    )
    .sort((a, b) => b.feedback.at - a.feedback.at);
  const ratingTest = ratingTestFor(ratingFilter);
  // The star level being shown on its own (e.g. 4), or null
  const starFilter = ratingFilter.startsWith("stars-")
    ? Number(ratingFilter.slice(6))
    : null;
  const feedbackList = agentFeedback.filter((t) =>
    ratingTest(t.feedback.rating),
  );
  const feedbackAverage = average(agentFeedback.map((t) => t.feedback.rating));
  const starCounts = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: agentFeedback.filter((t) => t.feedback.rating === stars).length,
  }));

  const periodText = rangeLabel(from, now);

  function chooseAgentFilter(id) {
    setAgentFilter(id);
    setFeedbackShown(FEEDBACK_PAGE);
  }

  function chooseRatingFilter(id) {
    setRatingFilter(id);
    setFeedbackShown(FEEDBACK_PAGE);
  }

  // "See feedback" on an agent's card: filter to them and jump down
  function showAgentFeedback(id) {
    chooseAgentFilter(id);
    setRatingFilter("all");
    feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exportReport() {
    const pct = (v) => (v === null ? "No data" : `${v}%`);
    const stars = (v) => (v === null ? "No ratings" : v.toFixed(1));

    downloadCsv(
      [
        ["Performance & Feedback", periodText],
        [],
        ["Summary", "This period", "Previous period"],
        [
          "First response on time",
          pct(current.responseOnTime),
          pct(previous.responseOnTime),
        ],
        [
          "Resolved on time",
          pct(current.resolvedOnTime),
          pct(previous.resolvedOnTime),
        ],
        ["Resolved late", current.late, previous.late],
        ["Average rating", stars(current.avgRating), stars(previous.avgRating)],
        [
          "Happy customers (4-5 stars)",
          pct(current.happy),
          pct(previous.happy),
        ],
        ["Overdue right now", overdueNow],
        ["At risk right now", atRiskNow],
        [],
        [
          "Agent",
          "First response on time",
          "Resolved on time",
          "Resolved",
          "Resolved late",
          "Overdue now",
          "At risk now",
          "Average rating",
          "Ratings",
          "Happy customers",
        ],
        ...agentCards.map(({ agent, stats }) => [
          agent.name,
          pct(stats.responseOnTime),
          pct(stats.resolvedOnTime),
          stats.resolved,
          stats.late,
          stats.overdueNow,
          stats.atRisk,
          stars(stats.avgRating),
          stats.ratingCount,
          pct(stats.happy),
        ]),
        [],
        ["Needs attention now", "Reason", "Priority", "Agent", "Due"],
        ...attention.map(({ ticket, reason }) => [
          `#${ticket.id} ${ticket.subject}`,
          reason.label,
          PRIORITIES[ticket.priority].label,
          findAgent(ticket.assignee)?.name ?? "Unassigned",
          new Date(ticket.dueBy).toLocaleString("en-US"),
        ]),
        [],
        ["Feedback", "Stars", "Comment", "Customer", "Agent", "Date"],
        ...tickets
          .filter((t) => t.feedback && inRange(t.feedback.at, from, Infinity))
          .sort((a, b) => b.feedback.at - a.feedback.at)
          .map((t) => [
            `#${t.id}`,
            t.feedback.rating,
            t.feedback.comment,
            t.requester.name,
            findAgent(t.assignee)?.name ?? "",
            new Date(t.feedback.at).toLocaleDateString("en-US"),
          ]),
      ],
      `performance-last-${days}-days.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Performance & Feedback
          </h1>
          <p className="mt-1 text-sm text-muted">
            How each agent is doing on response times (SLA) and customer
            feedback, {periodText}
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex flex-1 rounded-lg border border-line bg-white p-1 text-sm sm:flex-none">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => {
                  setDays(p.days);
                  setFeedbackShown(FEEDBACK_PAGE);
                }}
                className={`flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 transition active:scale-[0.97] sm:flex-none ${
                  days === p.days
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportReport}
            className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* The main numbers */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <StatCard
          label="First response on time"
          value={
            current.responseOnTime === null
              ? "No data"
              : `${current.responseOnTime}%`
          }
          trend={pointChange(current.responseOnTime, previous.responseOnTime)}
          unit=" pts"
          upIsGood
        />
        <StatCard
          label="Resolved on time"
          value={
            current.resolvedOnTime === null
              ? "No data"
              : `${current.resolvedOnTime}%`
          }
          trend={pointChange(current.resolvedOnTime, previous.resolvedOnTime)}
          unit=" pts"
          upIsGood
        />
        <StatCard
          label="Average rating"
          value={
            current.avgRating === null
              ? "No ratings"
              : `${current.avgRating.toFixed(1)} ★`
          }
          trend={ratingChange(current.avgRating, previous.avgRating)}
          unit=" stars"
          upIsGood
        />
        <StatCard
          label="Happy customers"
          value={current.happy === null ? "No ratings" : `${current.happy}%`}
          trend={pointChange(current.happy, previous.happy)}
          unit=" pts"
          upIsGood
        />
        <StatCard
          label="Overdue right now"
          value={overdueNow}
          note={overdueNow ? "Past their due time" : "Nothing overdue"}
          warn={overdueNow > 0}
        />
        <StatCard
          label="At risk right now"
          value={atRiskNow}
          note={
            atRiskNow
              ? `Due within ${AT_RISK_HOURS} hours or waiting for a reply`
              : "Every open ticket is on track"
          }
          warn={atRiskNow > 0}
        />
      </div>

      {/* Agent scorecards */}
      <div>
        <h2 className="text-lg font-semibold">Agents</h2>
        <p className="mb-3 text-sm text-muted">
          On-time rates and ratings for this period. Overdue and at risk are
          live.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {agentCards.map(({ agent, stats }) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              stats={stats}
              onShowFeedback={() => showAgentFeedback(agent.id)}
            />
          ))}
        </div>
      </div>

      {/* Tickets that need attention */}
      <Card title="Needs attention now">
        <p className="-mt-2 mb-3 text-sm text-muted">
          Open tickets that are overdue, still waiting for a first reply, or due
          within {AT_RISK_HOURS} hours.
        </p>
        {attention.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ShieldCheck className="h-8 w-8 text-brand" />
            <p className="text-sm text-muted">Every open ticket is on track.</p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line">
              {attentionShown.map(({ ticket, reason }) => (
                <li key={ticket.id}>
                  <Link
                    to={`/tickets/${ticket.id}`}
                    className="group -mx-2 flex flex-col gap-2 rounded-lg px-2 py-3 transition hover:bg-brand/5 active:bg-brand/10 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium transition group-hover:text-brand">
                        <span className="mr-2 text-muted">#{ticket.id}</span>
                        {ticket.subject}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {ticket.requester.name}, assigned to{" "}
                        {findAgent(ticket.assignee)?.name ?? "nobody yet"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${REASON_STYLES[reason.level]}`}
                      >
                        {reason.label}
                      </span>
                      <PriorityBadge priority={ticket.priority} />
                      <DueLabel ticket={ticket} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {attention.length > ATTENTION_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAllAttention((s) => !s)}
                className="mt-3 cursor-pointer text-sm font-medium text-brand hover:underline"
              >
                {showAllAttention
                  ? "Show fewer"
                  : `Show all ${attention.length}`}
              </button>
            )}
          </>
        )}
      </Card>

      {/* Customer feedback */}
      <div ref={feedbackRef} className="scroll-mt-20">
        <Card
          title="Customer feedback"
          action={
            <select
              value={agentFilter}
              onChange={(e) => chooseAgentFilter(e.target.value)}
              aria-label="Show feedback for"
              className={`${inputClass} h-9 w-auto cursor-pointer`}
            >
              <option value="all">All agents</option>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          }
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
            {/* Summary: average and how many of each star */}
            <div className="flex flex-col gap-4 lg:border-r lg:border-line lg:pr-6">
              <div>
                <p className="text-4xl font-semibold">
                  {feedbackAverage === null ? "–" : feedbackAverage.toFixed(1)}
                </p>
                <div className="mt-1">
                  <Stars rating={Math.round(feedbackAverage ?? 0)} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  {agentFeedback.length} rating
                  {agentFeedback.length === 1 ? "" : "s"} in this period
                </p>
              </div>
              {/* Tap a star row to show only those ratings; tap it again to show all */}
              <ul className="-mx-2 flex flex-col gap-1">
                {starCounts.map(({ stars, count }) => {
                  const active = starFilter === stars;
                  return (
                    <li key={stars}>
                      <button
                        type="button"
                        onClick={() =>
                          chooseRatingFilter(active ? "all" : `stars-${stars}`)
                        }
                        aria-pressed={active}
                        title={
                          active
                            ? "Show all ratings"
                            : `Show only ${stars}-star ratings`
                        }
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition active:scale-[0.98] ${
                          active
                            ? "bg-amber-50 font-medium text-ink ring-1 ring-amber-200"
                            : "text-muted hover:bg-page hover:text-ink"
                        }`}
                      >
                        <span className="flex w-7 shrink-0 items-center gap-0.5">
                          {stars}
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-page">
                          <span
                            className="block h-full rounded-full bg-amber-400 transition-all duration-500"
                            style={{
                              width: `${percent(count, agentFeedback.length) ?? 0}%`,
                            }}
                          />
                        </span>
                        <span className="w-6 shrink-0 text-right">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted">
                Tap a star row to see only those ratings.
              </p>
            </div>

            {/* The comments */}
            <div className="flex min-w-0 flex-col gap-4">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-lg border border-line bg-white p-1">
                  {RATING_FILTERS.map((f) => {
                    const count = agentFeedback.filter((t) =>
                      f.test(t.feedback.rating),
                    ).length;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => chooseRatingFilter(f.id)}
                        className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition active:scale-[0.97] ${
                          ratingFilter === f.id
                            ? "bg-brand/10 font-medium text-brand"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        {f.label}
                        <span
                          className={`rounded-full px-1.5 text-xs ${ratingFilter === f.id ? "bg-brand text-white" : "bg-page text-muted"}`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {starFilter && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="flex items-center gap-1">
                    Showing only {starFilter}
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    ratings
                  </span>
                  <button
                    type="button"
                    onClick={() => chooseRatingFilter("all")}
                    className="flex cursor-pointer items-center gap-1 font-medium hover:underline"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </div>
              )}

              {feedbackList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <MessageSquareText className="h-8 w-8 text-muted" />
                  <p className="text-sm text-muted">
                    No feedback like this in this period.
                  </p>
                </div>
              ) : (
                <>
                  <ul className="flex flex-col divide-y divide-line">
                    {feedbackList.slice(0, feedbackShown).map((t) => (
                      <FeedbackItem key={t.id} ticket={t} />
                    ))}
                  </ul>
                  {feedbackList.length > feedbackShown && (
                    <button
                      type="button"
                      onClick={() => setFeedbackShown((n) => n + FEEDBACK_PAGE)}
                      className="h-10 cursor-pointer self-center rounded-lg border border-line bg-white px-5 text-sm font-medium transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
                    >
                      Show more ({feedbackList.length - feedbackShown} left)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* SLA targets */}
      <Card title="SLA targets by priority">
        <p className="-mt-2 mb-4 text-sm text-muted">
          The time allowed for each priority, and how well it was met in this
          period.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="whitespace-nowrap bg-brand/10 text-brand">
                <th className="rounded-l-lg px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">First reply within</th>
                <th className="px-4 py-3 font-medium">Resolve within</th>
                <th className="px-4 py-3 font-medium">Tickets</th>
                <th className="px-4 py-3 font-medium">
                  First response on time
                </th>
                <th className="rounded-r-lg px-4 py-3 font-medium">
                  Resolved on time
                </th>
              </tr>
            </thead>
            <tbody>
              {priorityRows.map((row) => (
                <tr
                  key={row.priority}
                  className="group transition hover:bg-brand/5"
                >
                  <td className="border-b border-line px-4 py-3 group-last:border-0">
                    <PriorityBadge priority={row.priority} />
                  </td>
                  <td className="whitespace-nowrap border-b border-line px-4 py-3 group-last:border-0">
                    {hoursText(row.firstResponse)}
                  </td>
                  <td className="whitespace-nowrap border-b border-line px-4 py-3 group-last:border-0">
                    {hoursText(row.resolve)}
                  </td>
                  <td className="border-b border-line px-4 py-3 group-last:border-0">
                    {row.created}
                  </td>
                  <td className="border-b border-line px-4 py-3 group-last:border-0">
                    <OnTimeValue value={row.responseOnTime} />
                  </td>
                  <td className="border-b border-line px-4 py-3 group-last:border-0">
                    <OnTimeValue value={row.resolvedOnTime} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            These targets set the due time on every new ticket. Changing them
            from this page comes later.
          </p>
        </div>
      </Card>
    </div>
  );
}
