import { Calendar, Upload, TrendingUp, TrendingDown } from "lucide-react";
import TicketVolumeChart from "../TicketVolumeChart";
import ResponseTimeChart from "../ResponseTimeChart";
import LatestTickets from "../LatestTickets";

const stats = [
  { label: "Open Tickets", value: 52, change: 15, up: true },
  { label: "New Tickets", value: 36, change: 15, up: true },
  { label: "In Process Tickets", value: 41, change: 15, up: true },
  { label: "Closed Tickets", value: 45, change: 15, up: true },
];

function StatCard({ label, value, change, up }) {
  const TrendIcon = up ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">{value}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={`flex items-center gap-1 font-medium ${up ? "text-brand" : "text-red-500"}`}
        >
          <TrendIcon className="h-4 w-4" />
          {change}%
        </span>
        <span className="text-muted">{up ? "Up" : "Down"} from last hour</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
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
            <span className="truncate">Sept 30 – Oct 4, 2025</span>
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
