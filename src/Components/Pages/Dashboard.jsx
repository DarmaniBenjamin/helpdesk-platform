import { useState } from "react";
import { TrendingUp, TrendingDown, TriangleAlert } from "lucide-react";
import TicketVolumeChart from "../TicketVolumeChart";
import ResponseTimeChart from "../ResponseTimeChart";
import LatestTickets from "../LatestTickets";
import { isOverdue, DAY } from "../../data";
import useData from "../../useData";

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
  const { tickets } = useData();
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
