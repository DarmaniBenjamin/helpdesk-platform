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

// Wraps the whole app and keeps the tickets and customers in one place.
// Later, this is where the app will load from / save to the backend.
export default function DataProvider({ children }) {
  const [tickets, setTickets] = useState(startingTickets);
  const [customers, setCustomers] = useState(startingCustomers);

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
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
