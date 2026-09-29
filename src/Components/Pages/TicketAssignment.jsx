import { useState } from "react";
import {
  Download,
  Plus,
  SlidersHorizontal,
  ArrowRight,
  Info,
  Workflow,
  Server,
  Headset,
  Palette,
  Cctv,
  Layers,
} from "lucide-react";
import RuleModal from "../RuleModal";
import useData from "../../useData";
import {
  DEPARTMENTS,
  AGENTS,
  isDone,
  findDepartment,
  findAgent,
} from "../../data";

// Icons for the starting departments. Departments you create yourself
// get the general "layers" icon.
const TEAM_ICONS = {
  managed: Server,
  support: Headset,
  media: Palette,
  security: Cctv,
};
function TeamIcon({ id, className }) {
  const Icon = TEAM_ICONS[id] ?? Layers;
  return <Icon className={className} />;
}

// 95 minutes -> "1.6h", 40 -> "40m"
function formatResponse(minutes) {
  if (minutes === null) return "None yet";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

// How many existing tickets mention any of the rule's words
function countMatches(tickets, keywords) {
  return tickets.filter((t) => {
    const text = `${t.subject} ${t.description}`.toLowerCase();
    return keywords.some((word) => text.includes(word));
  }).length;
}

// Downloads the rules as a spreadsheet file (CSV)
function exportRules(rules) {
  const rows = [
    ["Rule", "Keywords", "Team", "Agent", "Enabled"],
    ...rules.map((r) => [
      r.name,
      r.keywords.join(" | "),
      findDepartment(r.department).name,
      findAgent(r.agent)?.name ?? "Anyone on the team",
      r.enabled ? "Yes" : "No",
    ]),
  ];
  // Wrap each value in quotes so commas inside names don't break the columns
  const csv = rows
    .map((row) =>
      row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "assignment-rules.csv";
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

function TeamCard({ department, tickets }) {
  const members = AGENTS.filter((a) =>
    a.departments.includes(department.id),
  ).length;
  const teamTickets = tickets.filter((t) => t.department === department.id);
  const active = teamTickets.filter((t) => !isDone(t)).length;
  const answered = teamTickets.filter((t) => t.firstRespondedAt);
  const avgMinutes = answered.length
    ? answered.reduce(
        (sum, t) => sum + (t.firstRespondedAt - t.createdAt) / 60000,
        0,
      ) / answered.length
    : null;

  return (
    <div className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <TeamIcon id={department.id} className="h-4 w-4" />
        </span>
        <p className="truncate font-semibold">{department.name}</p>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Members</dt>
          <dd className="font-medium">{members}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Active tickets</dt>
          <dd className="font-medium">{active}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Avg response</dt>
          <dd className="font-medium">{formatResponse(avgMinutes)}</dd>
        </div>
      </dl>
    </div>
  );
}

function RuleRow({ rule, tickets, onToggle, onEdit }) {
  const team = findDepartment(rule.department);
  const agent = findAgent(rule.agent);
  const matches = countMatches(tickets, rule.keywords);

  return (
    <li
      className={`flex flex-col gap-3 rounded-xl border p-4 transition sm:flex-row sm:items-start ${
        rule.enabled
          ? "border-line bg-white"
          : "border-dashed border-line bg-page/60"
      }`}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            rule.enabled ? "bg-brand/10 text-brand" : "bg-slate-200 text-muted"
          }`}
        >
          <TeamIcon id={rule.department} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`flex flex-wrap items-center gap-x-2 font-medium ${rule.enabled ? "" : "text-muted"}`}
          >
            {rule.name}
            <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
            <span className="text-brand">{team.name}</span>
          </p>
          {rule.description && (
            <p className="mt-0.5 text-sm text-muted">{rule.description}</p>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {rule.keywords.map((word) => (
              <span
                key={word}
                className="rounded-md border border-line bg-page px-2 py-0.5 text-xs"
              >
                {word}
              </span>
            ))}
          </div>

          <p className="mt-2 text-xs text-muted">
            Assign to{" "}
            <span className="font-medium text-brand">{team.name}</span>
            {agent && (
              <>
                {" "}
                · <span className="font-medium text-ink">{agent.name}</span>
              </>
            )}
            {" · "}
            {matches} existing ticket{matches === 1 ? "" : "s"} match
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3 sm:border-0 sm:pt-0">
        <span className="text-xs text-muted sm:hidden">
          {rule.enabled ? "On" : "Off"}
        </span>
        <Toggle
          on={rule.enabled}
          onChange={onToggle}
          label={`Turn ${rule.name} ${rule.enabled ? "off" : "on"}`}
        />
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${rule.name}`}
          className="cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92]"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export default function TicketAssignment() {
  const { tickets, rules, addRule, updateRule, deleteRule } = useData();

  // null = closed, "new" = creating, a rule = editing that rule
  const [editing, setEditing] = useState(null);

  const activeRules = rules.filter((r) => r.enabled).length;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Ticket Assignment
          </h1>
          <p className="mt-1 text-sm text-muted">
            Automatically assign tickets to agents and teams based on keywords,
            requests or characteristics.
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportRules(rules)}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Teams */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {DEPARTMENTS.map((d) => (
          <TeamCard key={d.id} department={d} tickets={tickets} />
        ))}
      </div>

      {/* Rules */}
      <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Assignment Rules</h2>
            <p className="text-sm text-muted">
              Configure automatic ticket routing based on conditions ·{" "}
              {activeRules} of {rules.length} on
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>

        {/* How they run (server/src/automation.js) */}
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-brand/5 px-3 py-2.5 text-sm text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <p>
            Every new ticket is checked against the rules that are on. The rule
            with the most of its keywords in the subject or description wins,
            and the ticket goes to its team (and person, if it has one). Rules
            only fill in what's missing, so a team or person picked by hand is
            never changed.
          </p>
        </div>

        {rules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Workflow className="h-8 w-8 text-muted" />
            <p className="text-sm text-muted">
              No rules yet. Create one to get started.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                tickets={tickets}
                onToggle={(on) =>
                  updateRule(rule.id, { enabled: on }).catch((err) =>
                    window.alert(err.message),
                  )
                }
                onEdit={() => setEditing(rule)}
              />
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <RuleModal
          rule={editing === "new" ? null : editing}
          onSave={(fields) =>
            editing === "new" ? addRule(fields) : updateRule(editing.id, fields)
          }
          onDelete={() => deleteRule(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
