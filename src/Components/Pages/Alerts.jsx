import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, CircleCheck, Hand, RotateCcw, Siren, Ticket } from "lucide-react";
import Droplets from "../Droplets";
import useSavedState from "../savedState";
import { primaryButton, secondaryButton } from "../formStyles";
import { api } from "../../api";
import { timeAgo } from "../../data";
import useData from "../../useData";

// Alerts: problems other systems report (the backup gateway), here instead
// of in the Inbox (server/src/alerts.js). Everyone on staff sees them.
// One alert per problem, per device; repeats are counted on it. Critical
// ones also make a ticket by themselves; the others with "Make a ticket".

const SEVERITY = {
  critical: { label: "Critical", dot: "bg-red-500", tone: "bg-red-50 text-red-700" },
  high: { label: "High", dot: "bg-orange-500", tone: "bg-orange-50 text-orange-700" },
  medium: { label: "Medium", dot: "bg-amber-400", tone: "bg-amber-50 text-amber-700" },
  low: { label: "Low", dot: "bg-slate-300", tone: "bg-line text-muted" },
  info: { label: "Info", dot: "bg-slate-200", tone: "bg-line text-muted" },
};
const STATUS = {
  open: { label: "Open", tone: "bg-red-50 text-red-700" },
  acknowledged: { label: "Someone's on it", tone: "bg-sky-50 text-sky-700" },
  resolved: { label: "Resolved", tone: "bg-brand/10 text-brand" },
};
const EVENT = {
  fired: "Alert",
  again: "Happened again",
  worse: "Got worse",
  "back to normal": "Back to normal",
  acknowledged: "On it",
  resolved: "Resolved",
  reopened: "Opened again",
  ticket: "Ticket",
};

const when = (time) => new Date(time).toLocaleString();

function Pill({ tone, children }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

function Detail({ id, version, onBack }) {
  const [alert, setAlert] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // (A new alert gets a new Detail: see key= below)
  useEffect(() => {
    let current = true;
    api(`/alerts/${id}`)
      .then((data) => current && setAlert(data))
      .catch((err) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [id, version]);

  async function act(what, path) {
    setBusy(what);
    setError("");
    try {
      setAlert(await api(`/alerts/${id}/${path}`, { method: "POST" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (!alert)
    return error ? (
      <p className="text-sm text-red-600">{error}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Droplets className="h-4 w-4" /> Loading…
      </p>
    );

  const s = SEVERITY[alert.severity] ?? SEVERITY.info;
  const open = alert.status !== "resolved";
  const button = (what, path, Icon, label, primary = false) => (
    <button
      type="button"
      disabled={Boolean(busy)}
      onClick={() => act(what, path)}
      className={`${primary ? primaryButton : secondaryButton} flex h-auto! min-h-11 basis-auto items-center justify-center gap-2 py-2 disabled:opacity-60`}
    >
      {busy === what ? <Droplets className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-ink lg:hidden">
        <ArrowLeft className="h-4 w-4" /> All alerts
      </button>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Alert #{alert.id}</span>
          <Pill tone={s.tone}>{s.label}</Pill>
          <Pill tone={STATUS[alert.status]?.tone ?? "bg-line text-muted"}>{STATUS[alert.status]?.label ?? alert.status}</Pill>
        </div>
        <h2 className="text-xl font-semibold wrap-break-word">{alert.title}</h2>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Customer</dt>
        <dd className="min-w-0 wrap-break-word">
          {alert.customerId ? (
            <Link to={`/customers/${alert.customerId}`} className="text-brand hover:underline">
              {alert.customer ?? `Customer #${alert.customerId}`}
            </Link>
          ) : (
            (alert.customer ?? "Not linked yet")
          )}
        </dd>
        {alert.device && (
          <>
            <dt className="text-muted">Device</dt>
            <dd className="min-w-0 wrap-break-word">{alert.device}</dd>
          </>
        )}
        <dt className="text-muted">Times</dt>
        <dd>{alert.count}</dd>
        <dt className="text-muted">First</dt>
        <dd>{when(alert.firstSeenAt)}</dd>
        <dt className="text-muted">Last</dt>
        <dd>{when(alert.lastSeenAt)}</dd>
        {alert.acknowledgedAt && (
          <>
            <dt className="text-muted">On it</dt>
            <dd>
              {alert.acknowledgedBy ?? "Someone"}, {timeAgo(alert.acknowledgedAt)}
            </dd>
          </>
        )}
        {alert.resolvedAt && (
          <>
            <dt className="text-muted">Resolved</dt>
            <dd>
              {alert.resolvedBy ?? "by itself (back to normal)"}, {timeAgo(alert.resolvedAt)}
            </dd>
          </>
        )}
        {alert.ticketId && (
          <>
            <dt className="text-muted">Ticket</dt>
            <dd>
              <Link to={`/tickets/${alert.ticketId}`} className="text-brand hover:underline">
                #{alert.ticketId}
              </Link>
            </dd>
          </>
        )}
      </dl>

      {alert.details && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Latest</h3>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-page p-3 font-sans text-sm">{alert.details}</pre>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap">
        {alert.status === "open" && button("ack", "acknowledge", Hand, "I'm on it", true)}
        {open && button("resolve", "resolve", CircleCheck, "Resolve")}
        {!open && button("reopen", "reopen", RotateCcw, "Open again")}
        {alert.customerId && !alert.ticketId && button("ticket", "ticket", Ticket, "Make a ticket")}
        {alert.ticketId && (
          <Link
            to={`/tickets/${alert.ticketId}`}
            className={`${secondaryButton} flex h-auto! min-h-11 basis-auto items-center justify-center gap-2 py-2`}
          >
            <Ticket className="h-4 w-4" /> Open ticket #{alert.ticketId}
          </Link>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">History</h3>
        <ol className="flex flex-col gap-3">
          {alert.events.map((e) => (
            <li key={e.id} className="text-sm">
              <p>
                <span className="font-medium">{EVENT[e.type] ?? e.type}</span>
                {e.actor && <span className="text-muted"> by {e.actor}</span>}
                <span className="text-muted"> · {timeAgo(e.at)}</span>
              </p>
              {e.body && <p className="mt-0.5 whitespace-pre-wrap text-muted wrap-break-word">{e.body}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function Alerts() {
  const { alertsVersion } = useData();
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get("id")) || null;
  const [status, setStatus] = useSavedState("alerts.status", "open");
  const [minor, setMinor] = useSavedState("alerts.minor", false);
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    api(`/alerts?status=${status}${minor ? "&minor=1" : ""}`)
      .then((data) => {
        if (!current) return;
        setList(data);
        setError("");
      })
      .catch((err) => current && setError(err.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [status, minor, alertsVersion]);

  const open = (id) => setParams(id ? { id: String(id) } : {});
  const choose = (next) => {
    if (next === status) return;
    setLoading(true);
    setStatus(next);
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Alerts</h1>
          <p className="mt-1 text-sm text-muted">
            Problems other systems report, like the backup gateway. Repeats are counted on one alert. Critical ones also
            make a ticket by themselves.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-sm">
            {[
              ["open", "Open"],
              ["resolved", "Resolved"],
              ["all", "All"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => choose(value)}
                className={`h-9 cursor-pointer whitespace-nowrap rounded-md px-3 ${status === value ? "bg-brand/10 font-medium text-brand" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted">
            <input
              type="checkbox"
              checked={minor}
              onChange={(e) => {
                setLoading(true);
                setMinor(e.target.checked);
              }}
            />
            Low and info too
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6">
        <section className={`rounded-xl border border-line bg-white ${selected ? "hidden lg:block" : ""}`}>
          {loading && !list ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted">
              <Droplets className="h-4 w-4" /> Loading…
            </p>
          ) : !list?.length ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">
              <Siren className="h-8 w-8" />
              <p className="font-medium text-ink">{status === "open" ? "No open alerts" : "No alerts here"}</p>
              <p className="text-sm">Alerts from the backup gateway show up here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((a) => {
                const s = SEVERITY[a.severity] ?? SEVERITY.info;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => open(a.id)}
                      className={`flex w-full cursor-pointer items-start gap-3 p-3 text-left transition hover:bg-page sm:p-4 ${selected === a.id ? "bg-brand/5" : ""}`}
                    >
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} title={s.label} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.title}</p>
                        <p className="truncate text-xs text-muted">
                          {[a.customer, a.device].filter(Boolean).join(" · ") || "Not linked yet"}
                          {a.count > 1 && ` · ${a.count} times`} · {timeAgo(a.lastSeenAt)}
                        </p>
                      </div>
                      <Pill tone={STATUS[a.status]?.tone ?? "bg-line text-muted"}>{STATUS[a.status]?.label ?? a.status}</Pill>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`rounded-xl border border-line bg-white p-4 sm:p-6 ${selected ? "" : "hidden lg:block"}`}>
          {selected ? (
            <Detail key={selected} id={selected} version={alertsVersion} onBack={() => open(null)} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
              <Siren className="h-8 w-8" />
              <p className="text-sm">Pick an alert to see what happened.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
