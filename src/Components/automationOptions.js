import {
  STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  AGENTS,
  findDepartment,
  findAgent,
} from "../data";

// What can start an automation. "param" says what extra detail it needs.
export const TRIGGERS = {
  created: { label: "A new ticket is created", kind: "Event" },
  customerReply: { label: "The customer replies", kind: "Event" },
  statusChanged: {
    label: "The status changes to",
    kind: "Event",
    param: "status",
  },
  noCustomerReply: {
    label: "No customer reply for",
    kind: "Time-based",
    param: "hours",
  },
  noAgentReply: {
    label: "No agent reply for",
    kind: "Time-based",
    param: "hours",
  },
  resolvedFor: {
    label: "Resolved with no reply for",
    kind: "Time-based",
    param: "days",
  },
};

// What an automation can do
export const ACTIONS = {
  setStatus: { label: "Set status to", param: "status" },
  setPriority: { label: "Set priority to", param: "priority" },
  assignTeam: { label: "Assign to team", param: "department" },
  assignAgent: { label: "Assign to agent", param: "agent" },
  emailCustomer: { label: "Email the customer", param: "text" },
  notifyTeam: { label: "Notify the team" },
  addNote: { label: "Add an internal note", param: "text" },
  addTag: { label: "Add a tag", param: "text" },
};

// The choices for each kind of detail
export const PARAM_OPTIONS = {
  status: Object.entries(STATUSES).map(([value, { label }]) => ({
    value,
    label,
  })),
  priority: Object.entries(PRIORITIES).map(([value, { label }]) => ({
    value: Number(value),
    label,
  })),
  department: DEPARTMENTS.map((d) => ({ value: d.id, label: d.name })),
  agent: AGENTS.map((a) => ({ value: a.id, label: a.name })),
};

// A sensible starting value when a trigger or action is picked
export function defaultParam(param) {
  if (param === "hours") return 24;
  if (param === "days") return 7;
  if (param === "text") return "";
  return PARAM_OPTIONS[param]?.[0].value ?? null;
}

// Turns a detail into words, e.g. "closed" -> "Closed", 24 hours -> "24 hours"
function paramText(param, value) {
  if (param === "hours") return `${value} hour${value === 1 ? "" : "s"}`;
  if (param === "days") return `${value} day${value === 1 ? "" : "s"}`;
  if (param === "department") return findDepartment(value)?.name;
  if (param === "agent") return findAgent(value)?.name;
  if (param === "text")
    return value
      ? `"${value.length > 30 ? value.slice(0, 30) + "…" : value}"`
      : "";
  return PARAM_OPTIONS[param]?.find((o) => o.value === value)?.label;
}

// "No customer reply for 24 hours"
export function describeTrigger(trigger) {
  const { label, param } = TRIGGERS[trigger.type];
  return param ? `${label} ${paramText(param, trigger.value)}` : label;
}

// "Set status to Closed"
export function describeAction(action) {
  const { label, param } = ACTIONS[action.type];
  return param ? `${label} ${paramText(param, action.value)}`.trim() : label;
}
