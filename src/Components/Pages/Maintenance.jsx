import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  Bug,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import Droplets from "../Droplets";
import MaintenanceSettings from "../MaintenanceSettings";
import useData from "../../useData";
import { inputClass, secondaryButton } from "../formStyles";
import { api } from "../../api";
import { timeAgo } from "../../data";

// Maintenance (Admins): every error the app ran into and every bug staff
// reported, as incidents (server/src/incidents.js). Repeats of the same
// error are counted on one incident. Click one to see the details: the
// error, where in the code it happened, its history, and (in later
// stages) the AI's findings and the proposed fix on GitHub.

const STATUS = {
  detected: { label: "Detected", tone: "bg-amber-50 text-amber-700" },
  investigating: { label: "Investigating", tone: "bg-sky-50 text-sky-700" },
  fix_proposed: { label: "Fix proposed", tone: "bg-sky-50 text-sky-700" },
  testing: { label: "Testing", tone: "bg-sky-50 text-sky-700" },
  awaiting_approval: { label: "Awaiting approval", tone: "bg-violet-50 text-violet-700" },
  approved: { label: "Approved", tone: "bg-violet-50 text-violet-700" },
  deployed: { label: "Deployed", tone: "bg-brand/10 text-brand" },
  verified: { label: "Verified fixed", tone: "bg-brand/10 text-brand" },
  failed: { label: "Fix failed", tone: "bg-red-50 text-red-600" },
  rejected: { label: "Fix rejected", tone: "bg-line text-muted" },
  rolled_back: { label: "Rolled back", tone: "bg-red-50 text-red-600" },
  dismissed: { label: "Dismissed", tone: "bg-line text-muted" },
};
const SEVERITY = {
  critical: { label: "Critical", dot: "bg-red-600" },
  high: { label: "High", dot: "bg-orange-500" },
  medium: { label: "Medium", dot: "bg-amber-400" },
  low: { label: "Low", dot: "bg-slate-300" },
};
const SOURCE = {
  server: "Server error",
  crash: "Crash",
  browser: "In someone's browser",
  user: "Reported by staff",
  health: "Health check",
  spike: "Many errors at once",
};
const EVENT = {
  detected: "Detected",
  recurred: "Happened again",
  dismissed: "Dismissed",
  reopened: "Reopened",
  investigation_requested: "AI investigation requested",
  investigation_result: "Investigation finished",
  approved: "Approved",
  rejected: "Fix rejected",
  review: "Reviewed on GitHub",
  pr_reopened: "Fix reopened",
  deployed: "Deployed",
  rolled_back: "Rolled back",
  verified: "Verified fixed",
};
// Statuses an investigation can be (re)started from
const CAN_INVESTIGATE = ["detected", "failed", "awaiting_approval", "rolled_back", "rejected"];

function StatusPill({ status }) {
  const s = STATUS[status] ?? { label: status, tone: "bg-line text-muted" };
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.tone}`}>
      {s.label}
    </span>
  );
}

function SeverityDot({ severity }) {
  const s = SEVERITY[severity] ?? SEVERITY.medium;
  return (
    <span
      title={`${s.label} severity`}
      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`}
    />
  );
}

const when = (time) => new Date(time).toLocaleString();

function Detail({ id, ai, onBack, onChanged }) {
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  // (A new incident gets a new Detail: see key= below, so nothing needs
  // clearing here)
  useEffect(() => {
    let current = true;
    api(`/incidents/${id}`)
      .then((data) => current && setIncident(data))
      .catch((err) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [id]);

  async function investigate() {
    setBusy("investigate");
    setError("");
    try {
      await api(`/incidents/${id}/investigate`, { method: "POST" });
      setIncident(await api(`/incidents/${id}`));
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function act(what, path, body) {
    setBusy(what);
    setError("");
    try {
      setIncident(await api(`/incidents/${id}/${path}`, { method: "POST", body }));
      setDismissing(false);
      setReason("");
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (error && !incident) return <p className="p-4 text-sm text-red-600">{error}</p>;
  if (!incident)
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted">
        <Droplets className="h-4 w-4" /> Loading…
      </p>
    );

  const context = Object.entries(incident.context ?? {});
  const finished = ["dismissed", "verified", "rejected"].includes(incident.status);
  const github = incident.github ?? {};
  const findings = incident.investigation ?? {};

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-brand lg:hidden"
      >
        <ArrowLeft className="h-4 w-4" /> All incidents
      </button>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Incident #{incident.id}</span>
          <StatusPill status={incident.status} />
          <span className="text-xs text-muted">
            {SEVERITY[incident.severity]?.label ?? incident.severity} severity
          </span>
        </div>
        <h2 className="text-lg font-semibold wrap-break-word">{incident.title}</h2>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {[
          ["Where", SOURCE[incident.source] ?? incident.source],
          ["Part of the app", incident.component],
          ["Kind", incident.category],
          ["Times", incident.count.toLocaleString()],
          ["First seen", when(incident.firstSeen)],
          ["Last seen", when(incident.lastSeen)],
          ...(incident.reportedBy ? [["Reported by", incident.reportedBy]] : []),
          ...(incident.lastRequestId ? [["Last request ID", incident.lastRequestId]] : []),
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="truncate" title={String(value)}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {incident.description && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">What they said</h3>
          <p className="whitespace-pre-wrap rounded-lg bg-page p-3 text-sm wrap-break-word">
            {incident.description}
          </p>
        </section>
      )}

      {incident.message && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Error</h3>
          <p className="rounded-lg bg-red-50 p-3 font-mono text-sm text-red-700 wrap-break-word">
            {incident.message}
          </p>
        </section>
      )}

      {incident.stack && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Where in the code</h3>
          <pre className="max-h-72 overflow-auto rounded-lg bg-page p-3 font-mono text-xs leading-relaxed">
            {incident.stack}
          </pre>
        </section>
      )}

      {context.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Details</h3>
          <dl className="grid gap-1 rounded-lg bg-page p-3 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4">
            {context.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{key}</dt>
                <dd className="mb-1 font-mono break-all sm:mb-0">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(findings.outcome || github.issueUrl) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">AI investigation</h3>
          {incident.status === "investigating" && (
            <p className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-700">
              <Droplets className="h-4 w-4" />
              Running on GitHub. Results appear here a few minutes after it finishes.
            </p>
          )}
          {findings.outcome && (
            <div className="flex flex-col gap-3 rounded-lg bg-page p-3 text-sm">
              {findings.sensitive && (
                <p className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-red-700">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  Sensitive change: it touches sign-in, permissions, secrets or
                  deleting data. Review it line by line; it can never be approved
                  automatically.
                </p>
              )}
              {findings.summary && <p className="whitespace-pre-wrap">{findings.summary}</p>}
              {findings.rootCause && (
                <p>
                  <span className="font-medium">Root cause</span>
                  {findings.confidence && (
                    <span className="text-muted"> ({findings.confidence} confidence)</span>
                  )}
                  : {findings.rootCause}
                </p>
              )}
              {[
                ["Confirmed", findings.confirmed],
                ["Not proven (hypotheses)", findings.hypotheses],
              ].map(
                ([label, items]) =>
                  items?.length > 0 && (
                    <div key={label}>
                      <p className="font-medium">{label}</p>
                      <ul className="list-disc pl-5 text-muted">
                        {items.map((x, n) => (
                          <li key={n}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
              {findings.checks?.length > 0 && (
                <div>
                  <p className="font-medium">
                    Checks{findings.attempt > 1 ? ` (attempt ${findings.attempt})` : ""}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {findings.checks.map((c) => (
                      <li key={c.name} className="flex items-center gap-2">
                        <span className={c.status === "passed" ? "text-brand" : "text-red-600"}>
                          {c.status === "passed" ? "✓" : "✗"}
                        </span>
                        {c.name}
                        {c.optional && <span className="text-xs text-muted">(informational)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {findings.model && (
                <p className="text-xs text-muted">
                  By {findings.provider} {findings.model}. AI findings can be wrong: check them.
                </p>
              )}
            </div>
          )}
          {github.mergedAt && (
            <div className="flex flex-col gap-1 rounded-lg bg-violet-50 p-3 text-sm text-violet-800">
              <p>
                Approved: merged on GitHub
                {github.mergedBy ? ` by ${github.mergedBy}` : ""}, {when(github.mergedAt)}.
                {github.deployedAt
                  ? ` Live since ${when(github.deployedAt)} (version ${String(github.deployedSha ?? "").slice(0, 7)}).`
                  : " It goes live with the next deploy (update-uplink)."}
              </p>
              {github.approvalWarnings?.map((w) => (
                <p key={w} className="flex items-start gap-1.5 text-red-700">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {github.prUrl && (
              <a href={github.prUrl} target="_blank" rel="noreferrer" className={`${secondaryButton} flex items-center gap-2`}>
                <ExternalLink className="h-4 w-4" /> Proposed fix (#{github.prNumber})
              </a>
            )}
            {github.issueUrl && (
              <a href={github.issueUrl} target="_blank" rel="noreferrer" className={`${secondaryButton} flex items-center gap-2`}>
                <ExternalLink className="h-4 w-4" /> GitHub issue
              </a>
            )}
            {github.runUrl && (
              <a href={github.runUrl} target="_blank" rel="noreferrer" className={`${secondaryButton} flex items-center gap-2`}>
                <ExternalLink className="h-4 w-4" /> Investigation run
              </a>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">History</h3>
        <ol className="flex flex-col gap-2 border-l border-line pl-4">
          {incident.events.map((e) => (
            <li key={e.id} className="text-sm">
              <p>
                <span className="font-medium">{EVENT[e.type] ?? e.type.replace(/_/g, " ")}</span>
                {e.actor && <span className="text-muted"> by {e.actor}</span>}
                <span className="text-muted"> · {timeAgo(e.at)}</span>
              </p>
              {e.body && <p className="text-muted wrap-break-word">{e.body}</p>}
            </li>
          ))}
        </ol>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        {ai?.configured && CAN_INVESTIGATE.includes(incident.status) && (
          <div className="flex">
            <button
              type="button"
              disabled={busy === "investigate"}
              onClick={investigate}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] disabled:opacity-60"
            >
              {busy === "investigate" ? <Droplets className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {github.issueNumber ? "Investigate again" : "Investigate with AI"}
            </button>
          </div>
        )}
        {finished ? (
          <div className="flex">
            <button
              type="button"
              disabled={busy === "reopen"}
              onClick={() => act("reopen", "reopen")}
              className={`${secondaryButton} flex items-center justify-center gap-2`}
            >
              <RotateCcw className="h-4 w-4" /> Reopen
            </button>
          </div>
        ) : dismissing ? (
          <div className="flex flex-col gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Why it isn't a real problem (optional)"
              className={inputClass}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === "dismiss"}
                onClick={() => act("dismiss", "dismiss", { reason })}
                className="h-11 cursor-pointer rounded-lg bg-slate-700 px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                Dismiss it
              </button>
              <button type="button" onClick={() => setDismissing(false)} className={secondaryButton}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex">
            <button
              type="button"
              onClick={() => setDismissing(true)}
              className={`${secondaryButton} flex items-center justify-center gap-2`}
            >
              <XCircle className="h-4 w-4" /> Dismiss: not a real problem
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Maintenance() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const [showAll, setShowAll] = useState(false);
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Bumped to load the list again (Refresh, or after a change)
  const [reloads, setReloads] = useState(0);
  const [ai, setAi] = useState(null);
  const [aiReloads, setAiReloads] = useState(0);
  const { me } = useData();
  const superAdmin = me?.role === "owner";

  useEffect(() => {
    api("/incidents/ai-status")
      .then(setAi)
      .catch(() => setAi(null));
  }, [aiReloads]);

  useEffect(() => {
    let current = true;
    api(`/incidents${showAll ? "?all=1" : ""}`)
      .then((data) => {
        if (!current) return;
        setList(data.incidents);
        setError("");
      })
      .catch((err) => current && setError(err.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [showAll, reloads]);

  const load = useCallback(() => {
    setLoading(true);
    setReloads((n) => n + 1);
  }, []);

  const open = (id) => setParams(id ? { id: String(id) } : {});

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Maintenance</h1>
          <p className="text-sm text-muted">
            Errors the helpdesk ran into, and bugs the team reported. Repeats of
            the same error are counted on one incident.
          </p>
          {ai && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <Sparkles className="h-3.5 w-3.5" />
              {ai.configured
                ? `AI investigations are on (${ai.auto ? "automatic, within limits" : "Investigate button only"}). ${ai.used.month} of ${ai.maxPerMonth} used this month. ${ai.webhook ? "Approvals show up as soon as a fix is merged." : "Approvals show up within 5 minutes of a fix being merged."}`
                : superAdmin
                  ? "AI investigations are off. Set them up in AI & GitHub below."
                  : "AI investigations are off. The Super Admin can turn them on here."}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-sm">
            {[
              [false, "Open"],
              [true, "All"],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (showAll === value) return;
                  setLoading(true);
                  setShowAll(value);
                }}
                className={`h-9 cursor-pointer rounded-md px-3 ${
                  showAll === value ? "bg-brand/10 font-medium text-brand" : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-brand"
          >
            {loading ? <Droplets className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {superAdmin && <MaintenanceSettings onChanged={() => setAiReloads((n) => n + 1)} />}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6">
        <section
          className={`rounded-xl border border-line bg-white ${selected ? "hidden lg:block" : ""}`}
        >
          {!list ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted">
              <Droplets className="h-4 w-4" /> Loading…
            </p>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <ShieldCheck className="h-8 w-8 text-brand" />
              <p className="font-medium">Nothing to look at</p>
              <p className="text-sm text-muted">
                {showAll ? "No incidents yet." : "No open incidents."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => open(i.id)}
                    className={`flex w-full cursor-pointer items-start gap-3 p-3 text-left transition hover:bg-page sm:p-4 ${
                      String(i.id) === selected ? "bg-brand/5" : ""
                    }`}
                  >
                    <SeverityDot severity={i.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.title}</p>
                      <p className="truncate text-xs text-muted">
                        #{i.id} · {SOURCE[i.source] ?? i.source}
                        {i.count > 1 ? ` · ${i.count.toLocaleString()} times` : ""} ·{" "}
                        {timeAgo(i.lastSeen)}
                      </p>
                    </div>
                    <StatusPill status={i.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className={`rounded-xl border border-line bg-white p-4 sm:p-6 ${
            selected ? "" : "hidden lg:block"
          }`}
        >
          {selected ? (
            <Detail key={selected} id={selected} ai={ai} onBack={() => open(null)} onChanged={load} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
              <Bug className="h-8 w-8" />
              <p className="text-sm">Pick an incident to see what happened.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
