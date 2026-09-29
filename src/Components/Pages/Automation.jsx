import { useState } from "react";
import {
  Download,
  Plus,
  SlidersHorizontal,
  ArrowRight,
  Info,
  Zap,
  Clock,
  Workflow,
  Activity,
  Timer,
} from "lucide-react";
import AutomationModal from "../AutomationModal";
import useData from "../../useData";
import {
  TRIGGERS,
  describeTrigger,
  describeAction,
} from "../automationOptions";

// Roughly how long an agent would spend doing one action by hand
const MINUTES_PER_ACTION = 1.5;

// Downloads the automations as a spreadsheet file (CSV)
function exportAutomations(automations) {
  const rows = [
    ["Automation", "When", "Then", "Enabled", "Times run"],
    ...automations.map((a) => [
      a.name,
      describeTrigger(a.trigger),
      a.actions.map(describeAction).join(" | "),
      a.enabled ? "Yes" : "No",
      a.runs,
    ]),
  ];
  // Wrap each value in quotes so commas inside text don't break the columns
  const csv = rows
    .map((row) =>
      row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "automations.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

// The on/off switch
function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${on ? "bg-brand" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function StatCard({ icon, label, value, note }) {
  const Icon = icon;
  return (
    <div className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        <Icon className="h-4 w-4 text-brand" />
      </div>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">{value}</p>
      <p className="mt-2 text-xs text-muted">{note}</p>
    </div>
  );
}

function AutomationRow({ automation, onToggle, onEdit }) {
  const { kind } = TRIGGERS[automation.trigger.type];
  const Icon = kind === "Time-based" ? Clock : Zap;
  const on = automation.enabled;

  return (
    <li
      className={`group flex flex-col gap-3 rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:flex-row sm:items-start ${
        on
          ? "border-line bg-white hover:border-brand/30"
          : "border-dashed border-line bg-page/60"
      }`}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            on ? "bg-brand/10 text-brand" : "bg-slate-200 text-muted"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium transition group-hover:text-brand ${on ? "" : "text-muted"}`}
          >
            {automation.name}
          </p>
          {automation.description && (
            <p className="mt-0.5 text-sm text-muted">
              {automation.description}
            </p>
          )}

          {/* The flow: trigger → action → action */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-md bg-brand/10 px-2 py-1 font-medium text-brand">
              {kind}: {describeTrigger(automation.trigger)}
            </span>
            {automation.actions.map((action, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="rounded-md border border-line bg-page px-2 py-1">
                  {describeAction(action)}
                </span>
              </span>
            ))}
          </div>

          <p className="mt-2 text-xs text-muted">
            Executed{" "}
            <span className="font-medium text-brand">
              {automation.runs.toLocaleString()}
            </span>{" "}
            times
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3 sm:border-0 sm:pt-0">
        <span className="text-xs text-muted sm:hidden">
          {on ? "On" : "Off"}
        </span>
        <Toggle
          on={on}
          onChange={onToggle}
          label={`Turn ${automation.name} ${on ? "off" : "on"}`}
        />
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${automation.name}`}
          className="cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92]"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export default function Automation() {
  const { automations, addAutomation, updateAutomation, deleteAutomation } =
    useData();

  // null = closed, "new" = creating, an automation = editing it
  const [editing, setEditing] = useState(null);

  const activeCount = automations.filter((a) => a.enabled).length;
  const actionsRun = automations.reduce(
    (sum, a) => sum + a.runs * a.actions.length,
    0,
  );
  const hoursSaved = Math.round((actionsRun * MINUTES_PER_ACTION) / 60);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Automation</h1>
          <p className="mt-1 text-sm text-muted">
            Automate recurring tasks and perform multiple actions on a ticket
            with a single trigger.
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportAutomations(automations)}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          icon={Workflow}
          label="Active Automations"
          value={activeCount}
          note={`Out of ${automations.length} total`}
        />
        <StatCard
          icon={Activity}
          label="Actions Performed"
          value={actionsRun.toLocaleString()}
          note="Across all automations"
        />
        <StatCard
          icon={Timer}
          label="Time Saved"
          value={`${hoursSaved}h`}
          note={`Estimated at ${MINUTES_PER_ACTION} min per action`}
        />
      </div>

      {/* Automations */}
      <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Automation Rules</h2>
            <p className="text-sm text-muted">
              Configure automated workflows to streamline your support process
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Create Automation
          </button>
        </div>

        {/* How they run (server/src/automation.js) */}
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-brand/5 px-3 py-2.5 text-sm text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <p>
            Automations that are on run by themselves. "New ticket", "customer
            replies" and "status changes" ones run straight away; the time-based
            ones are checked every 5 minutes and run once each time a ticket has
            waited long enough. Everything they do shows in the ticket's history
            with the automation's name.
          </p>
        </div>

        {automations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Zap className="h-8 w-8 text-muted" />
            <p className="text-sm text-muted">
              No automations yet. Create one to get started.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {automations.map((a) => (
              <AutomationRow
                key={a.id}
                automation={a}
                onToggle={(on) =>
                  updateAutomation(a.id, { enabled: on }).catch((err) =>
                    window.alert(err.message),
                  )
                }
                onEdit={() => setEditing(a)}
              />
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <AutomationModal
          automation={editing === "new" ? null : editing}
          onSave={(fields) =>
            editing === "new"
              ? addAutomation(fields)
              : updateAutomation(editing.id, fields)
          }
          onDelete={() => deleteAutomation(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
