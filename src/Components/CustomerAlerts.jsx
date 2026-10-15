import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { timeAgo } from "../data";
import useData from "../useData";

// A customer's latest alerts (the Alerts page: Pages/Alerts.jsx), on their
// page in the Customers list. Only shown when they have some.

const DOT = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-400",
  low: "bg-slate-300",
  info: "bg-slate-200",
};
const STATUS = { open: "Open", acknowledged: "Someone's on it", resolved: "Resolved" };

export default function CustomerAlerts({ customerId }) {
  const { alertsVersion } = useData();
  const [list, setList] = useState([]);

  useEffect(() => {
    let current = true;
    api(`/alerts?status=all&minor=1&customerId=${customerId}`)
      .then((data) => current && setList(data.slice(0, 5)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [customerId, alertsVersion]);

  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Alerts</h2>
        <Link to="/alerts" className="text-sm text-brand hover:underline">
          All alerts
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {list.map((a) => (
          <li key={a.id}>
            <Link
              to={`/alerts?id=${a.id}`}
              className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition hover:bg-page active:bg-brand/5"
            >
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[a.severity] ?? DOT.info}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="truncate text-xs text-muted">
                  {[a.device, STATUS[a.status] ?? a.status].filter(Boolean).join(" · ")}
                  {a.count > 1 && ` · ${a.count} times`} · {timeAgo(a.lastSeenAt)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
