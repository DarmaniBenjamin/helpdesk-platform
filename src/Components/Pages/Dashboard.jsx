import {
  Calendar,
  Upload,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import TicketVolumeChart from "../TicketVolumeChart";
import ResponseTimeChart from "../ResponseTimeChart";
import LatestTickets from "../LatestTickets";
import { tickets, isOverdue, DAY } from "../../data";

// % change from last week to this week (null if last week was 0)
function percentChange(thisWeek, lastWeek) {
  if (lastWeek === 0) return null;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
}

// Counts tickets whose `field` time falls between `from` and `to`
function countBetween(field, from, to) {
  return tickets.filter((t) => t[field] && t[field] >= from && t[field] < to)
    .length;
}

function StatCard({ label, value, note, warn, trend, upIsGood }) {
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
            <span className="text-muted">vs last week</span>
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
  const now = Date.now();
  const weekAgo = now - 7 * DAY;
  const twoWeeksAgo = now - 14 * DAY;

  const openCount = tickets.filter((t) => t.status === "open").length;
  const overdueCount = tickets.filter(isOverdue).length;
  const waitingCount = tickets.filter((t) => t.status === "waiting").length;
  const createdThisWeek = countBetween("createdAt", weekAgo, now);
  const createdLastWeek = countBetween("createdAt", twoWeeksAgo, weekAgo);
  const resolvedThisWeek = countBetween("resolvedAt", weekAgo, now);
  const resolvedLastWeek = countBetween("resolvedAt", twoWeeksAgo, weekAgo);

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
      label: "Created This Week",
      value: createdThisWeek,
      trend: percentChange(createdThisWeek, createdLastWeek),
      upIsGood: false,
    },
    {
      label: "Resolved This Week",
      value: resolvedThisWeek,
      trend: percentChange(resolvedThisWeek, resolvedLastWeek),
      upIsGood: true,
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
          <button className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97] sm:flex-none">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="truncate">Last 7 days</span>
          </button>
          <button className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]">
            <Upload className="h-4 w-4" />
            Export
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
