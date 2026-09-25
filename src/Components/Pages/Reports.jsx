import { useState } from "react";
import { Link } from "react-router";
import {
  Download,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "../Card";
import Avatar from "../Avatar";
import PriorityBadge from "../PriorityBadge";
import useData from "../../useData";
import {
  STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  AGENTS,
  isDone,
  isOverdue,
} from "../../data";

// ---------- Settings ----------

// The time ranges you can pick at the top of the page
const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

// The same greens as the Ticket Volume chart on the Dashboard
const STATUS_COLORS = {
  open: "#00b67a",
  pending: "#1f8a5f",
  waiting: "#16372c",
  resolved: "#7ee2c1",
  closed: "#c3d9cf",
};

// How tickets came in
const SOURCES = {
  email: "Email",
  portal: "Customer portal",
  phone: "Phone",
  agent: "Created by an agent",
};

// Monday first, like a work week (getDay() gives Sunday = 0)
const WEEKDAYS = [
  { index: 1, label: "Mon" },
  { index: 2, label: "Tue" },
  { index: 3, label: "Wed" },
  { index: 4, label: "Thu" },
  { index: 5, label: "Fri" },
  { index: 6, label: "Sat" },
  { index: 0, label: "Sun" },
];

// Same padding and bottom line for every table cell
const cell = "border-b border-line px-4 py-3 group-last:border-0";
const headCell = "px-4 py-3 font-medium";

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

// Minutes as text: 45 -> "45m", 200 -> "3.3h", 3000 -> "2.1d"
function formatDuration(minutes) {
  if (minutes === null) return "No data";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 24 * 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (24 * 60)).toFixed(1)}d`;
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

// Change from the previous period as a %, for counts and times
function percentChange(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// Change in percentage points, for "on time" percentages (80% -> 85% = +5 pts)
function pointChange(current, previous) {
  if (current === null || previous === null) return null;
  return current - previous;
}

// The main numbers for tickets created or resolved between `from` and `to`
function periodStats(tickets, from, to) {
  const created = tickets.filter((t) => inRange(t.createdAt, from, to));
  const resolved = tickets.filter((t) => inRange(t.resolvedAt, from, to));
  const responded = created.filter((t) => t.firstRespondedAt);

  return {
    created: created.length,
    resolved: resolved.length,
    avgResponse: average(
      responded.map((t) => (t.firstRespondedAt - t.createdAt) / 60000),
    ),
    avgResolution: average(
      resolved.map((t) => (t.resolvedAt - t.createdAt) / 60000),
    ),
    responseOnTime: percent(
      responded.filter((t) => t.firstRespondedAt <= t.firstResponseDue).length,
      responded.length,
    ),
    resolvedOnTime: percent(
      resolved.filter((t) => t.resolvedAt <= t.dueBy).length,
      resolved.length,
    ),
  };
}

// The same numbers for one team, agent or priority, plus how many are open right now
function breakdown(tickets, from, matches) {
  const theirs = tickets.filter(matches);
  return {
    ...periodStats(theirs, from, Infinity),
    openNow: theirs.filter((t) => !isDone(t)).length,
    overdueNow: theirs.filter(isOverdue).length,
  };
}

// Created vs resolved, split into days (7 or 30 days) or weeks (90 days)
function trendBuckets(tickets, from, days) {
  const size = days > 31 ? 7 : 1;
  const count = Math.ceil(days / size);
  const buckets = [];

  for (let i = 0; i < count; i++) {
    const start = dayStart(from, i * size);
    // The last bucket runs to "now", so brand-new tickets still show up
    const end = i === count - 1 ? Infinity : dayStart(from, (i + 1) * size);
    const date = new Date(start);
    const label = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    buckets.push({
      label,
      title:
        size === 7
          ? `Week of ${label}`
          : date.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
      created: tickets.filter((t) => inRange(t.createdAt, start, end)).length,
      resolved: tickets.filter((t) => inRange(t.resolvedAt, start, end)).length,
    });
  }
  return buckets;
}

// Downloads rows as a spreadsheet file (CSV)
function downloadCsv(rows, filename) {
  // Wrap each value in quotes so commas inside names don't break the columns
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

function StatCard({ label, value, note, warn, trend, unit = "%", upIsGood }) {
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

// "92%" in green, "80%" in amber, "60%" in red
function OnTimeValue({ value }) {
  if (value === null) return <span className="text-muted">No data</span>;
  const color =
    value >= 90
      ? "text-brand"
      : value >= 75
        ? "text-amber-600"
        : "text-red-500";
  return <span className={`font-medium ${color}`}>{value}%</span>;
}

// A label, a count and a bar showing its share of the total
function MeterRow({ label, count, total, color }) {
  const width = total ? (count / total) * 100 : 0;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-muted">
          {count}{" "}
          <span className="text-xs">({percent(count, total) ?? 0}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-page">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    </li>
  );
}

// The table used for teams, agents and priorities
function BreakdownTable({ firstColumn, rows, renderName }) {
  const maxCreated = Math.max(1, ...rows.map((r) => r.created));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-200 border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="whitespace-nowrap bg-brand/10 text-brand">
            <th className={`${headCell} rounded-l-lg`}>{firstColumn}</th>
            <th className={headCell}>Created</th>
            <th className={headCell}>Resolved</th>
            <th className={headCell}>Open now</th>
            <th className={headCell}>Avg first response</th>
            <th className={headCell}>Avg resolution</th>
            <th className={`${headCell} rounded-r-lg`}>Resolved on time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group transition hover:bg-brand/5">
              <td className={`${cell} whitespace-nowrap font-medium`}>
                {renderName(row)}
              </td>
              <td className={cell}>
                <div className="flex items-center gap-3">
                  <span className="w-8 shrink-0">{row.created}</span>
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-page">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${(row.created / maxCreated) * 100}%` }}
                    />
                  </span>
                </div>
              </td>
              <td className={cell}>{row.resolved}</td>
              <td className={`${cell} whitespace-nowrap`}>
                {row.openNow}
                {row.overdueNow > 0 && (
                  <span className="ml-2 text-xs font-medium text-red-500">
                    {row.overdueNow} overdue
                  </span>
                )}
              </td>
              <td className={`${cell} whitespace-nowrap`}>
                {formatDuration(row.avgResponse)}
              </td>
              <td className={`${cell} whitespace-nowrap`}>
                {formatDuration(row.avgResolution)}
              </td>
              <td className={cell}>
                <OnTimeValue value={row.resolvedOnTime} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-muted">{item.title}</p>
      <p>
        <span className="font-semibold">{item.created}</span> created
      </p>
      <p>
        <span className="font-semibold text-brand">{item.resolved}</span>{" "}
        resolved
      </p>
    </div>
  );
}

function DayTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md">
      <p className="text-muted">{item.label}</p>
      <p className="text-sm font-semibold">
        {item.count} ticket{item.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

// ---------- The page ----------

export default function Reports() {
  const { tickets } = useData();
  // The time the page opened (the period is counted back from today)
  const [now] = useState(() => Date.now());
  const [days, setDays] = useState(30);

  // This period starts at midnight `days - 1` days ago and runs until now.
  // The previous period is the same length, just before it.
  const from = dayStart(now, -(days - 1));
  const previousFrom = dayStart(now, -(2 * days - 1));

  // Infinity as the end: tickets created or resolved after the page opened still count
  const current = periodStats(tickets, from, Infinity);
  const previous = periodStats(tickets, previousFrom, from);

  // Right now (not tied to the period)
  const openNow = tickets.filter((t) => !isDone(t));
  const overdueNow = openNow.filter(isOverdue).length;
  const unassignedNow = openNow.filter((t) => !t.assignee).length;

  const createdInPeriod = tickets.filter((t) =>
    inRange(t.createdAt, from, Infinity),
  );
  const trend = trendBuckets(tickets, from, days);

  const teams = DEPARTMENTS.map((d) => ({
    id: d.id,
    name: d.name,
    ...breakdown(tickets, from, (t) => t.department === d.id),
  }));
  const agents = AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    ...breakdown(tickets, from, (t) => t.assignee === a.id),
  }));
  // Urgent first
  const priorities = Object.keys(PRIORITIES)
    .map(Number)
    .reverse()
    .map((p) => ({
      id: p,
      ...breakdown(tickets, from, (t) => t.priority === p),
    }));

  const byStatus = Object.keys(STATUSES).map((id) => ({
    id,
    label: STATUSES[id].label,
    count: tickets.filter((t) => t.status === id).length,
  }));
  const bySource = Object.keys(SOURCES).map((id) => ({
    id,
    label: SOURCES[id],
    count: createdInPeriod.filter((t) => t.source === id).length,
  }));
  const byWeekday = WEEKDAYS.map((w) => ({
    ...w,
    count: createdInPeriod.filter(
      (t) => new Date(t.createdAt).getDay() === w.index,
    ).length,
  }));
  const busiestCount = Math.max(...byWeekday.map((w) => w.count));
  const busiestDay = byWeekday.find((w) => w.count === busiestCount);

  // Customers with the most tickets in the period
  const perCustomer = {};
  for (const t of createdInPeriod) {
    const entry = (perCustomer[t.customerId] ??= {
      customer: t.requester,
      count: 0,
      open: 0,
    });
    entry.count += 1;
    if (!isDone(t)) entry.open += 1;
  }
  const topCustomers = Object.values(perCustomer)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const periodText = rangeLabel(from, now);

  function exportReport() {
    const onTime = (v) => (v === null ? "No data" : `${v}%`);
    const tableRows = (rows, nameOf) =>
      rows.map((r) => [
        nameOf(r),
        r.created,
        r.resolved,
        r.openNow,
        r.overdueNow,
        formatDuration(r.avgResponse),
        formatDuration(r.avgResolution),
        onTime(r.resolvedOnTime),
      ]);
    const tableHeader = (first) => [
      first,
      "Created",
      "Resolved",
      "Open now",
      "Overdue now",
      "Avg first response",
      "Avg resolution",
      "Resolved on time",
    ];

    downloadCsv(
      [
        ["Report and Statistics", periodText],
        [],
        ["Summary", "This period", "Previous period"],
        ["Tickets created", current.created, previous.created],
        ["Tickets resolved", current.resolved, previous.resolved],
        [
          "Avg first response",
          formatDuration(current.avgResponse),
          formatDuration(previous.avgResponse),
        ],
        [
          "Avg resolution",
          formatDuration(current.avgResolution),
          formatDuration(previous.avgResolution),
        ],
        [
          "First response on time",
          onTime(current.responseOnTime),
          onTime(previous.responseOnTime),
        ],
        [
          "Resolved on time",
          onTime(current.resolvedOnTime),
          onTime(previous.resolvedOnTime),
        ],
        ["Open right now", openNow.length],
        ["Overdue right now", overdueNow],
        ["Unassigned right now", unassignedNow],
        [],
        tableHeader("Team"),
        ...tableRows(teams, (r) => r.name),
        [],
        tableHeader("Agent"),
        ...tableRows(agents, (r) => r.name),
        [],
        tableHeader("Priority"),
        ...tableRows(priorities, (r) => PRIORITIES[r.id].label),
      ],
      `report-last-${days}-days.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Report and Statistics
          </h1>
          <p className="mt-1 text-sm text-muted">
            Everything in your helpdesk for {periodText}
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex flex-1 rounded-lg border border-line bg-white p-1 text-sm sm:flex-none">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Tickets created"
          value={current.created}
          trend={percentChange(current.created, previous.created)}
          upIsGood={false}
        />
        <StatCard
          label="Tickets resolved"
          value={current.resolved}
          trend={percentChange(current.resolved, previous.resolved)}
          upIsGood
        />
        <StatCard
          label="Avg first response"
          value={formatDuration(current.avgResponse)}
          trend={percentChange(current.avgResponse, previous.avgResponse)}
          upIsGood={false}
        />
        <StatCard
          label="Avg resolution time"
          value={formatDuration(current.avgResolution)}
          trend={percentChange(current.avgResolution, previous.avgResolution)}
          upIsGood={false}
        />
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
          label="Open right now"
          value={openNow.length}
          note={overdueNow ? `${overdueNow} overdue` : "Nothing overdue"}
          warn={overdueNow > 0}
        />
        <StatCard
          label="Unassigned right now"
          value={unassignedNow}
          note={
            unassignedNow
              ? `${unassignedNow} need${unassignedNow === 1 ? "s" : ""} an agent`
              : "Every open ticket has an agent"
          }
          warn={unassignedNow > 0}
        />
      </div>

      {/* Created vs resolved over time */}
      <Card
        title="Created vs resolved"
        action={
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#16372c]" />
              Created
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand" />
              Resolved
            </span>
          </div>
        }
      >
        <p className="-mt-2 mb-4 text-sm text-muted">
          {days > 31 ? "Per week" : "Per day"}. When the dark line stays above
          the green one, the backlog is growing.
        </p>
        <div className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 5, right: 10, left: 0 }}>
              <CartesianGrid
                vertical={false}
                strokeDasharray="4 4"
                stroke="#eaecf0"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
                tick={{ fontSize: 11, fill: "#667085" }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={32}
                tick={{ fontSize: 11, fill: "#667085" }}
              />
              <Tooltip
                content={<TrendTooltip />}
                cursor={{ stroke: "#eaecf0", strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="created"
                stroke="#16372c"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="resolved"
                stroke="#00b67a"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Status and channels */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="Status right now">
          <p className="-mt-2 mb-4 text-sm text-muted">
            All {tickets.length} tickets, as they are at this moment.
          </p>
          <ul className="flex flex-col gap-3">
            {byStatus.map((s) => (
              <MeterRow
                key={s.id}
                label={s.label}
                count={s.count}
                total={tickets.length}
                color={STATUS_COLORS[s.id]}
              />
            ))}
          </ul>
        </Card>

        <Card title="How tickets came in">
          <p className="-mt-2 mb-4 text-sm text-muted">
            {createdInPeriod.length} ticket
            {createdInPeriod.length === 1 ? "" : "s"} created in this period.
          </p>
          <ul className="flex flex-col gap-3">
            {bySource.map((s) => (
              <MeterRow
                key={s.id}
                label={s.label}
                count={s.count}
                total={createdInPeriod.length}
                color="#00b67a"
              />
            ))}
          </ul>
        </Card>
      </div>

      {/* Teams */}
      <Card title="By team">
        <p className="-mt-2 mb-4 text-sm text-muted">
          Created, resolved and timings are for this period. "Open now" is live.
        </p>
        <BreakdownTable
          firstColumn="Team"
          rows={teams}
          renderName={(row) => row.name}
        />
      </Card>

      {/* Agents */}
      <Card title="By agent">
        <p className="-mt-2 mb-4 text-sm text-muted">
          Tickets assigned to each agent.{" "}
          {unassignedNow > 0 &&
            `${unassignedNow} open ticket${unassignedNow === 1 ? " has" : "s have"} no agent yet.`}
        </p>
        <BreakdownTable
          firstColumn="Agent"
          rows={agents}
          renderName={(row) => (
            <span className="flex items-center gap-2">
              <Avatar name={row.name} size="sm" />
              {row.name}
            </span>
          )}
        />
      </Card>

      {/* Priorities */}
      <Card title="By priority">
        <p className="-mt-2 mb-4 text-sm text-muted">
          Higher priorities have shorter due times, so on-time rates matter most
          at the top.
        </p>
        <BreakdownTable
          firstColumn="Priority"
          rows={priorities}
          renderName={(row) => <PriorityBadge priority={row.id} />}
        />
      </Card>

      {/* Busiest days and top customers */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="Busiest days">
          <p className="-mt-2 mb-4 text-sm text-muted">
            {busiestCount > 0
              ? `${busiestDay.label} brings in the most tickets in this period.`
              : "No tickets in this period."}
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byWeekday} margin={{ top: 5, right: 5, left: 0 }}>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="4 4"
                  stroke="#eaecf0"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#667085" }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  tick={{ fontSize: 11, fill: "#667085" }}
                />
                <Tooltip
                  content={<DayTooltip />}
                  cursor={{ fill: "#f5f7f8" }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {byWeekday.map((w) => (
                    <Cell
                      key={w.label}
                      fill={
                        w.count === busiestCount && w.count > 0
                          ? "#00b67a"
                          : "#c3d9cf"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Top customers">
          <p className="-mt-2 mb-4 text-sm text-muted">
            Who sent the most tickets in this period.
          </p>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted">No tickets in this period.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {topCustomers.map(({ customer, count, open }) => (
                <li key={customer.id}>
                  <Link
                    to={`/customers/${customer.id}`}
                    className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-brand/5 active:bg-brand/10"
                  >
                    <Avatar name={customer.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium transition group-hover:text-brand">
                        {customer.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {customer.company ?? "Individual"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <span className="block font-medium">
                        {count} ticket{count === 1 ? "" : "s"}
                      </span>
                      {open > 0 && (
                        <span className="block text-xs text-brand">
                          {open} open
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
