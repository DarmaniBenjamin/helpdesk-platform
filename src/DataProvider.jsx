import { useState } from "react";
import { DataContext } from "./useData";
import {
  tickets as startingTickets,
  customers as startingCustomers,
  SLA_HOURS,
  STATUSES,
  PRIORITIES,
  HOUR,
  isDone,
  findAgent,
  findDepartment,
} from "./data";

// Who is logged in. Becomes the real user once login exists.
export const CURRENT_USER = "SM Ashik";

// Setting a status also sets/clears the resolved and closed times
function applyStatus(ticket, status, now) {
  const next = { ...ticket, status };
  if (isDone(next)) {
    next.resolvedAt ??= now;
    if (status === "closed") next.closedAt ??= now;
  } else {
    next.resolvedAt = null; // reopened
    next.closedAt = null;
  }
  return next;
}

// Turns a change into a line for the ticket's history, e.g. "changed status to Resolved"
function describeChange(field, value) {
  switch (field) {
    case "status":
      return `changed status to ${STATUSES[value].label}`;
    case "priority":
      return `changed priority to ${PRIORITIES[value].label}`;
    case "department":
      return `moved the ticket to ${findDepartment(value).name}`;
    case "assignee":
      return value
        ? `assigned the ticket to ${findAgent(value).name}`
        : "unassigned the ticket";
    case "dueBy":
      return `changed the due date to ${new Date(value).toLocaleString(
        "en-US",
        {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        },
      )}`;
    default:
      return `updated ${field}`;
  }
}

// Assignment rules to start with. They're saved and shown, but don't
// run automatically yet: that gets decided later.
const STARTING_RULES = [
  {
    id: 1,
    name: "Billing questions",
    description:
      "Invoices, payments and quotes go straight to the billing team.",
    keywords: ["invoice", "billing", "payment", "quote"],
    department: "bill",
    agent: "a4",
    enabled: true,
  },
  {
    id: 2,
    name: "Network problems",
    description: "Wi-Fi, VPN and internet issues go to the networking team.",
    keywords: ["wi-fi", "vpn", "internet", "access point"],
    department: "net",
    agent: null,
    enabled: true,
  },
  {
    id: 3,
    name: "Email and accounts",
    description:
      "Outlook, mailboxes, OneDrive and sign-in problems go to Microsoft 365.",
    keywords: ["outlook", "mailbox", "onedrive", "authenticator"],
    department: "m365",
    agent: "a2",
    enabled: true,
  },
  {
    id: 4,
    name: "Backups and servers",
    description: "Failed backups, restores and server space warnings.",
    keywords: ["backup", "restore", "server"],
    department: "srv",
    agent: null,
    enabled: false,
  },
];

// Automations to start with. Like the rules, they're saved and shown
// but don't run yet.
const STARTING_AUTOMATIONS = [
  {
    id: 1,
    name: "Auto-close resolved tickets",
    description:
      "Close tickets that have been resolved for 7 days without a customer reply.",
    trigger: { type: "resolvedFor", value: 7 },
    actions: [
      { type: "setStatus", value: "closed" },
      {
        type: "emailCustomer",
        value: "We've closed your ticket. Just reply if you still need help.",
      },
    ],
    enabled: true,
    runs: 234,
  },
  {
    id: 2,
    name: "Welcome email for new tickets",
    description:
      "Let customers know we got their request as soon as a ticket is created.",
    trigger: { type: "created", value: null },
    actions: [
      {
        type: "emailCustomer",
        value:
          "Thanks, we've received your request and will be in touch shortly.",
      },
      { type: "addTag", value: "new" },
    ],
    enabled: true,
    runs: 2134,
  },
  {
    id: 3,
    name: "Priority escalation",
    description: "Raise the priority if nobody has replied within 4 hours.",
    trigger: { type: "noAgentReply", value: 4 },
    actions: [
      { type: "setPriority", value: 4 },
      { type: "notifyTeam", value: null },
      {
        type: "addNote",
        value: "Escalated automatically: no reply within 4 hours.",
      },
    ],
    enabled: true,
    runs: 432,
  },
  {
    id: 4,
    name: "Reopen when the customer replies",
    description:
      "If a customer answers a ticket we're waiting on, put it back in the queue.",
    trigger: { type: "customerReply", value: null },
    actions: [{ type: "setStatus", value: "open" }],
    enabled: false,
    runs: 0,
  },
];

// Wraps the whole app and keeps the tickets and customers in one place.
// Later, this is where the app will load from / save to the backend.
export default function DataProvider({ children }) {
  const [tickets, setTickets] = useState(startingTickets);
  const [customers, setCustomers] = useState(startingCustomers);
  const [rules, setRules] = useState(STARTING_RULES);
  const [automations, setAutomations] = useState(STARTING_AUTOMATIONS);

  // ---------- Automations ----------

  function addAutomation(fields) {
    const automation = {
      ...fields,
      id: Math.max(0, ...automations.map((a) => a.id)) + 1,
      enabled: true,
      runs: 0,
    };
    setAutomations((list) => [...list, automation]);
    return automation;
  }

  function updateAutomation(id, changes) {
    setAutomations((list) =>
      list.map((a) => (a.id === id ? { ...a, ...changes } : a)),
    );
  }

  function deleteAutomation(id) {
    setAutomations((list) => list.filter((a) => a.id !== id));
  }

  // ---------- Assignment rules ----------

  function addRule(fields) {
    const rule = {
      ...fields,
      id: Math.max(0, ...rules.map((r) => r.id)) + 1,
      enabled: true,
    };
    setRules((list) => [...list, rule]);
    return rule;
  }

  function updateRule(id, changes) {
    setRules((list) =>
      list.map((r) => (r.id === id ? { ...r, ...changes } : r)),
    );
  }

  function deleteRule(id) {
    setRules((list) => list.filter((r) => r.id !== id));
  }

  // ---------- Customers ----------

  function addCustomer(fields) {
    const customer = {
      id: Math.max(...customers.map((c) => c.id)) + 1,
      name: fields.name.trim(),
      email: fields.email.trim().toLowerCase(),
      phone: fields.phone.trim(),
      company: fields.company.trim() || null, // empty means an individual
      extraEmails: [],
      extraPhones: [],
      createdAt: Date.now(),
    };
    setCustomers((list) => [customer, ...list]);
    return customer;
  }

  function updateCustomer(id, changes) {
    const current = customers.find((c) => c.id === id);
    const updated = { ...current, ...changes };
    setCustomers((list) => list.map((c) => (c.id === id ? updated : c)));
    // Tickets keep a copy of their customer, so update those too
    setTickets((list) =>
      list.map((t) => (t.customerId === id ? { ...t, requester: updated } : t)),
    );
  }

  // Which customer (if any) uses this email, as their main or an extra email?
  function findCustomerByEmail(email) {
    const wanted = email.trim().toLowerCase();
    return customers.find(
      (c) => c.email === wanted || (c.extraEmails ?? []).includes(wanted),
    );
  }

  // ---------- Tickets ----------

  function addTicket({
    customer,
    subject,
    department,
    priority,
    dueBy,
    description,
  }) {
    const now = Date.now();
    const ticket = {
      id: Math.max(...tickets.map((t) => t.id)) + 1,
      subject,
      description,
      status: "open",
      priority,
      department,
      customerId: customer.id,
      requester: customer,
      assignee: null,
      source: "agent",
      createdAt: now,
      firstResponseDue: now + SLA_HOURS[priority].firstResponse * HOUR,
      dueBy,
      firstRespondedAt: null,
      resolvedAt: null,
      closedAt: null,
      messages: [
        {
          id: 1,
          kind: "customer",
          author: customer.name,
          body: description,
          at: now,
        },
      ],
      updatedAt: now,
    };
    setTickets((list) => [ticket, ...list]); // newest first
    return ticket;
  }

  // Change fields on a ticket, e.g. updateTicket(4819, { status: "resolved" }).
  // Each change is also written into the ticket's history.
  function updateTicket(id, changes) {
    const now = Date.now();
    setTickets((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        let next = { ...t, ...changes, updatedAt: now };
        if (changes.status) next = applyStatus(next, changes.status, now);

        const events = Object.entries(changes)
          .filter(([field, value]) => t[field] !== value)
          .map(([field, value], i) => ({
            id: t.messages.length + i + 1,
            kind: "event",
            author: CURRENT_USER,
            body: describeChange(field, value),
            at: now,
          }));
        next.messages = [...t.messages, ...events];
        return next;
      }),
    );
  }

  // Add a reply ("agent") or internal note ("note"), and optionally change the status
  function addMessage(id, kind, body, newStatus) {
    const now = Date.now();
    setTickets((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        const messages = [
          ...t.messages,
          {
            id: t.messages.length + 1,
            kind,
            author: CURRENT_USER,
            body,
            at: now,
          },
        ];
        let next = { ...t, messages, updatedAt: now };

        // The first reply to the customer counts as the "first response"
        if (kind === "agent" && !t.firstRespondedAt)
          next.firstRespondedAt = now;

        if (newStatus && newStatus !== t.status) {
          next = applyStatus(next, newStatus, now);
          next.messages = [
            ...messages,
            {
              id: messages.length + 1,
              kind: "event",
              author: CURRENT_USER,
              body: describeChange("status", newStatus),
              at: now,
            },
          ];
        }
        return next;
      }),
    );
  }

  return (
    <DataContext.Provider
      value={{
        tickets,
        customers,
        addTicket,
        updateTicket,
        addMessage,
        addCustomer,
        updateCustomer,
        findCustomerByEmail,
        rules,
        addRule,
        updateRule,
        deleteRule,
        automations,
        addAutomation,
        updateAutomation,
        deleteAutomation,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
