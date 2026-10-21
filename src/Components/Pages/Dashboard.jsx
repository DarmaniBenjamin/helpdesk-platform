import { useState } from "react";
import {
  Download,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import TicketVolumeChart from "../TicketVolumeChart";
import ResponseTimeChart from "../ResponseTimeChart";
import LatestTickets from "../LatestTickets";
import { isOverdue, DAY, STATUSES, PRIORITIES } from "../../data";
import useData from "../../useData";
import { downloadCsv } from "../csv";

// How far back "Created" and "Resolved" count
const PERIODS = [7, 30, 90];

// % change from last week to this week (null if last week was 0)
function percentChange(thisWeek, lastWeek) {
  if (lastWeek === 0) return null;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
}

// Counts tickets whose `field` time falls between `from` and `to`
function countBetween(tickets, field, from, to) {
  return tickets.filter((t) => t[field] && t[field] >= from && t[field] < to)
    .length;
}

function StatCard({ label, value, note, warn, trend, upIsGood, trendWord }) {
  const hasTrend = trend !== undefined && trend !== null;
  const good = hasTrend && trend >= 0 === upIsGood;
  const TrendIcon = hasTrend && trend < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">{value}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {hasTrend ? (
          <>
            <span
              className={`flex items-center gap-1 font-medium ${good ? "text-brand" : "text-red-500"}`}
            >
              <TrendIcon className="h-4 w-4" />
              {Math.abs(trend)}%
            </span>
            <span className="text-muted">vs the {trendWord}</span>
          </>
        ) : (
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

export default function Dashboard() {
  const { tickets, agents } = useData();
  // The time when the page opened (the period counts back from here)
  const [now] = useState(() => Date.now());
  const [days, setDays] = useState(7);
  const weekAgo = now - days * DAY;
  const twoWeeksAgo = now - 2 * days * DAY;
  const trendWord = `${days} days before`;

  const openCount = tickets.filter((t) => t.status === "open").length;
  const overdueCount = tickets.filter(isOverdue).length;
  const waitingCount = tickets.filter((t) => t.status === "waiting").length;
  const createdThisWeek = countBetween(tickets, "createdAt", weekAgo, now);
  const createdLastWeek = countBetween(
    tickets,
    "createdAt",
    twoWeeksAgo,
    weekAgo,
  );
  const resolvedThisWeek = countBetween(tickets, "resolvedAt", weekAgo, now);
  const resolvedLastWeek = countBetween(
    tickets,
    "resolvedAt",
    twoWeeksAgo,
    weekAgo,
  );

  const stats = [
    {
      label: "Open Tickets",
      value: openCount,
      note: overdueCount ? `${overdueCount} overdue` : "Nothing overdue",
      warn: overdueCount > 0,
    },
    {
      label: "Waiting on Customer",
      value: waitingCount,
      note: "Waiting for a reply",
    },
    {
      label: `Created, last ${days} days`,
      value: createdThisWeek,
      trend: percentChange(createdThisWeek, createdLastWeek),
      upIsGood: false,
      trendWord,
    },
    {
      label: `Resolved, last ${days} days`,
      value: resolvedThisWeek,
      trend: percentChange(resolvedThisWeek, resolvedLastWeek),
      upIsGood: true,
      trendWord,
    },
  ];

  // A spreadsheet of what's shown: the numbers, then every ticket made
  // in the period
  function exportDashboard() {
    const date = (t) => (t ? new Date(t).toLocaleString() : "");
    const who = (id) => agents.find((a) => a.id === id)?.name ?? "";
    const made = tickets
      .filter((t) => t.createdAt >= weekAgo && t.createdAt < now)
      .sort((a, b) => b.createdAt - a.createdAt);
    downloadCsv(
      [
        [`Dashboard, last ${days} days`, new Date(now).toLocaleString()],
        [],
        ["Open tickets", openCount],
        ["Overdue", overdueCount],
        ["Waiting on customer", waitingCount],
        [`Created, last ${days} days`, createdThisWeek],
        [`Created, the ${days} days before`, createdLastWeek],
        [`Resolved, last ${days} days`, resolvedThisWeek],
        [`Resolved, the ${days} days before`, resolvedLastWeek],
        [],
        [
          "Ticket",
          "Subject",
          "Customer",
          "Status",
          "Priority",
          "Assigned to",
          "Created",
          "Resolved",
        ],
        ...made.map((t) => [
          `#${t.id}`,
          t.subject,
          t.requester?.name ?? "",
          STATUSES[t.status]?.label ?? t.status,
          PRIORITIES[t.priority]?.label ?? t.priority,
          who(t.assignee),
          date(t.createdAt),
          date(t.resolvedAt),
        ]),
      ],
      `dashboard-${days}-days-${new Date(now).toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Admin Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">
            Monitor your support ticket system with real-time data
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex flex-1 rounded-lg border border-line bg-white p-1 text-sm sm:flex-none">
            {PERIODS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 transition active:scale-[0.97] sm:flex-none ${
                  days === d
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-muted hover:text-ink"
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportDashboard}
            aria-label="Export"
            title="Download these numbers and tickets (CSV)"
            className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TicketVolumeChart />
        <ResponseTimeChart />
      </div>

      <LatestTickets />
    </div>
  );
}
