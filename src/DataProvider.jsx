import { useState } from "react";
import { DataContext } from "./useData";
import { STARTING_ANSWERS } from "./Components/Knowledge";
import {
  tickets as startingTickets,
  customers as startingCustomers,
  SLA_HOURS,
  STATUSES,
  PRIORITIES,
  HOUR,
  DAY,
  isDone,
  findAgent,
  findDepartment,
} from "./data";

// Which member of the team is logged in. Becomes the real user once
// login exists. Their name, photo etc. live in the team list below, so
// changing them on the My profile page updates the whole app.
export const CURRENT_USER_ID = "owner";

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

// The people who can sign in: your staff, plus customers who have access
// to the customer portal. The first four staff have the same ids as the
// agents in data.js, so tickets already assigned to them still match.
// "invited" people haven't set their password yet.
// Customers are linked to their customer record with customerId.
// Everyone has the same profile fields: name, email, phone and photo.
const now = Date.now();
const STARTING_TEAM = [
  {
    id: "owner",
    name: "SM Ashik",
    email: "ashik@example.com",
    phone: "+1 (473) 440-1200",
    photo: null,
    role: "owner",
    departments: [],
    status: "active",
    invitedAt: null,
    joinedAt: now - 400 * DAY,
    lastActiveAt: now - 5 * 60 * 1000,
  },
  {
    id: "a1",
    name: "Alex Charles",
    email: "alex.charles@example.com",
    phone: "+1 (473) 405-2231",
    photo: null,
    role: "admin",
    departments: ["it", "net", "srv"],
    status: "active",
    invitedAt: null,
    joinedAt: now - 320 * DAY,
    lastActiveAt: now - 40 * 60 * 1000,
  },
  {
    id: "a2",
    name: "Kerry-Ann Joseph",
    email: "kerryann.joseph@example.com",
    phone: "+1 (473) 418-7764",
    photo: null,
    role: "agent",
    departments: ["m365", "it"],
    status: "active",
    invitedAt: null,
    joinedAt: now - 210 * DAY,
    lastActiveAt: now - 2 * HOUR,
  },
  {
    id: "a3",
    name: "Marcus Pierre",
    email: "marcus.pierre@example.com",
    phone: "+1 (473) 409-3380",
    photo: null,
    role: "agent",
    departments: ["net", "cctv"],
    status: "active",
    invitedAt: null,
    joinedAt: now - 150 * DAY,
    lastActiveAt: now - 26 * HOUR,
  },
  {
    id: "a4",
    name: "Shanice Thomas",
    email: "shanice.thomas@example.com",
    phone: "+1 (473) 421-5519",
    photo: null,
    role: "supervisor",
    departments: ["bill", "it", "srv"],
    status: "active",
    invitedAt: null,
    joinedAt: now - 280 * DAY,
    lastActiveAt: now - 3 * HOUR,
  },
  {
    id: "m1",
    name: "Jordan Baptiste",
    email: "jordan.baptiste@example.com",
    phone: "",
    photo: null,
    role: "agent",
    departments: ["it"],
    status: "invited",
    invitedAt: now - 2 * DAY,
    joinedAt: null,
    lastActiveAt: null,
  },
  {
    id: "m2",
    name: "",
    email: "helpdesk.temp@example.com",
    phone: "",
    photo: null,
    role: "agent",
    departments: ["cctv"],
    status: "invited",
    invitedAt: now - 6 * HOUR,
    joinedAt: null,
    lastActiveAt: null,
  },
  {
    id: "c1",
    name: startingCustomers[0].name,
    email: startingCustomers[0].email,
    phone: startingCustomers[0].phone,
    photo: null,
    role: "customer",
    customerId: startingCustomers[0].id,
    departments: [],
    status: "active",
    invitedAt: null,
    joinedAt: now - 60 * DAY,
    lastActiveAt: now - 5 * HOUR,
  },
  {
    id: "c2",
    name: startingCustomers[1].name,
    email: startingCustomers[1].email,
    phone: startingCustomers[1].phone,
    photo: null,
    role: "customer",
    customerId: startingCustomers[1].id,
    departments: [],
    status: "invited",
    invitedAt: now - 1 * DAY,
    joinedAt: null,
    lastActiveAt: null,
  },
];

// Wraps the whole app and keeps the tickets and customers in one place.
// Later, this is where the app will load from / save to the backend.
export default function DataProvider({ children }) {
  const [tickets, setTickets] = useState(startingTickets);
  const [customers, setCustomers] = useState(startingCustomers);
  const [rules, setRules] = useState(STARTING_RULES);
  const [automations, setAutomations] = useState(STARTING_AUTOMATIONS);
  const [answers, setAnswers] = useState(STARTING_ANSWERS);
  const [team, setTeam] = useState(STARTING_TEAM);

  // The logged-in person, and the name written on their replies and notes
  const me = team.find((m) => m.id === CURRENT_USER_ID);
  const myName = me.name;

  // ---------- Team ----------

  // Is this email already on the team (signed up or invited)?
  function findMemberByEmail(email) {
    const wanted = email.trim().toLowerCase();
    return team.find((m) => m.email === wanted);
  }

  // Adds someone as "invited". Later, the backend sends them an email
  // with a link to set their password, and they become "active".
  function inviteMember({ email, name, role, departments }) {
    const member = {
      id: `m${Date.now()}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: "",
      photo: null,
      role,
      departments,
      status: "invited",
      invitedAt: Date.now(),
      joinedAt: null,
      lastActiveAt: null,
    };
    setTeam((list) => [...list, member]);
    return member;
  }

  // Gives a customer access to the customer portal, where they can
  // only see their own tickets
  function inviteCustomer(customer) {
    const member = {
      id: `c${Date.now()}`,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      photo: null,
      role: "customer",
      customerId: customer.id,
      departments: [],
      status: "invited",
      invitedAt: Date.now(),
      joinedAt: null,
      lastActiveAt: null,
    };
    setTeam((list) => [...list, member]);
    return member;
  }

  function updateMember(id, changes) {
    setTeam((list) =>
      list.map((m) => (m.id === id ? { ...m, ...changes } : m)),
    );
    // A customer's name, email and phone also live on their customer
    // record, so keep the two the same
    const member = team.find((m) => m.id === id);
    if (member?.customerId) {
      const shared = {};
      for (const field of ["name", "email", "phone"])
        if (field in changes) shared[field] = changes[field];
      if (Object.keys(shared).length) updateCustomer(member.customerId, shared);
    }
  }

  // Sends the invite again (for now, just restarts the "Invited ... ago" time)
  function resendInvite(id) {
    updateMember(id, { invitedAt: Date.now() });
  }

  // Takes someone off the team (or away from the customer portal).
  // A staff member's unfinished tickets become unassigned, with a line in
  // each ticket's history saying why. A customer's tickets are left alone.
  function removeMember(id) {
    const member = team.find((m) => m.id === id);
    if (!member || member.role === "owner") return;
    setTeam((list) => list.filter((m) => m.id !== id));

    // Invites and customers have no tickets assigned to them
    if (member.status !== "active" || member.role === "customer") return;
    const time = Date.now();
    setTickets((list) =>
      list.map((t) => {
        if (t.assignee !== id || isDone(t)) return t;
        return {
          ...t,
          assignee: null,
          updatedAt: time,
          messages: [
            ...t.messages,
            {
              id: t.messages.length + 1,
              kind: "event",
              author: myName,
              body: `unassigned the ticket (${member.name} was removed from the team)`,
              at: time,
            },
          ],
        };
      }),
    );
  }

  // ---------- Saved answers (knowledge base) ----------

  function addAnswer(fields) {
    const now = Date.now();
    const answer = {
      ticketId: null,
      source: "manual",
      author: myName,
      ...fields,
      id: Math.max(0, ...answers.map((a) => a.id)) + 1,
      createdAt: now,
      updatedAt: now,
      uses: 0,
    };
    setAnswers((list) => [answer, ...list]); // newest first
    return answer;
  }

  function updateAnswer(id, changes) {
    setAnswers((list) =>
      list.map((a) =>
        a.id === id ? { ...a, ...changes, updatedAt: Date.now() } : a,
      ),
    );
  }

  function deleteAnswer(id) {
    setAnswers((list) => list.filter((a) => a.id !== id));
  }

  // Count how often an answer gets copied, so the most useful ones can rise to the top
  function recordAnswerUse(id) {
    setAnswers((list) =>
      list.map((a) => (a.id === id ? { ...a, uses: a.uses + 1 } : a)),
    );
  }

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
    // So does their portal login, if they have one
    setTeam((list) =>
      list.map((m) =>
        m.customerId === id
          ? {
              ...m,
              name: updated.name,
              email: updated.email,
              phone: updated.phone,
            }
          : m,
      ),
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
            author: myName,
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
            author: myName,
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
              author: myName,
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
        answers,
        addAnswer,
        updateAnswer,
        deleteAnswer,
        recordAnswerUse,
        team,
        me,
        findMemberByEmail,
        inviteMember,
        inviteCustomer,
        updateMember,
        resendInvite,
        removeMember,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
