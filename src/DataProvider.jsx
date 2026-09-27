import { useEffect, useState } from "react";
import { DataContext } from "./useData";
import { api } from "../server/src/api";
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
  STARTING_DEPARTMENTS,
  syncDirectory,
} from "./data";
import { BACKUP_APP, BACKUP_VERSION } from "./Components/backupUtils";

// ---------- Signing in ----------
// Real accounts sign in through the backend (see server/src/auth.js): the
// server checks the password and keeps you signed in with a secure cookie.
//
// While the rest of the app still uses example data, the example people
// (agents, admins, a customer) can be tried out with the "Demo accounts"
// buttons on the sign-in page. Those only exist while running
// "npm run dev", never on the real site, and don't touch the database.
const DEMO_ALLOWED = import.meta.env.DEV;
const DEMO_KEY = "helpdesk-demo-session";

function readDemo() {
  if (!DEMO_ALLOWED) return null;
  try {
    return localStorage.getItem(DEMO_KEY);
  } catch {
    return null; // private browsing can block storage
  }
}

function saveDemo(id) {
  try {
    if (id) localStorage.setItem(DEMO_KEY, id);
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    // Storage blocked: the demo just won't survive a refresh
  }
}

// Puts the real signed-in person into the team list, in place of the
// example Super Admin, so every page that uses the team (Team, "Assigned
// to", "You" tags...) shows them
function withRealUser(list, user) {
  return [
    user,
    ...list.filter(
      (m) =>
        m.id !== user.id &&
        m.email !== user.email &&
        !(user.role === "owner" && m.role === "owner"),
    ),
  ];
}

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
    name: "Website and design",
    description:
      "Website changes, flyers, logos and social media go to Web + Media.",
    keywords: ["website", "flyer", "logo", "social media"],
    department: "media",
    agent: "a2",
    enabled: true,
  },
  {
    id: 2,
    name: "Network problems",
    description: "Wi-Fi and internet problems go to Support.",
    keywords: ["wi-fi", "wifi", "internet", "access point"],
    department: "support",
    agent: null,
    enabled: true,
  },
  {
    id: 3,
    name: "Email and accounts",
    description:
      "Mailboxes, OneDrive and Microsoft 365 go to Managed Services.",
    keywords: ["mailbox", "onedrive", "microsoft 365", "outlook"],
    department: "managed",
    agent: "a1",
    enabled: true,
  },
  {
    id: 4,
    name: "Backups and servers",
    description: "Failed backups, restores and server space warnings.",
    keywords: ["backup", "restore", "server"],
    department: "managed",
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
// Staff also have a job title (what they do at work, typed in freely) and
// an access level (role: what they can do in the app, see teamRoles.js).
// "owner" is the Super Admin.
const now = Date.now();
const STARTING_TEAM = [
  {
    id: "owner",
    name: "SM Ashik",
    email: "ashik@example.com",
    phone: "+1 (473) 440-1200",
    photo: null,
    role: "owner",
    title: "Managing Director",
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
    title: "IT Manager",
    departments: ["managed", "support"],
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
    title: "Digital Media Designer",
    departments: ["media", "support"],
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
    title: "Field Technician",
    departments: ["security", "managed"],
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
    role: "agent",
    title: "IT Support Technician",
    departments: ["support", "managed"],
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
    title: "IT Support Technician",
    departments: ["support"],
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
    title: "Field Technician",
    departments: ["security"],
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

// App settings. Backup destinations and the Freshdesk connection are saved
// here now and switched on once the backend exists.
const STARTING_SETTINGS = {
  backup: {
    destination: "download", // "download", "gdrive" or "b2"
    schedule: "daily", // "off", "daily" or "weekly"
    keep: 14, // how many old backups to keep
    lastBackupAt: null,
  },
  freshdesk: {
    domain: "", // e.g. "protonic" for protonic.freshdesk.com
  },
};

// Wraps the whole app and keeps the tickets and customers in one place.
// Later, this is where the app will load from / save to the backend.
export default function DataProvider({ children }) {
  const [tickets, setTickets] = useState(startingTickets);
  const [customers, setCustomers] = useState(startingCustomers);
  const [rules, setRules] = useState(STARTING_RULES);
  const [automations, setAutomations] = useState(STARTING_AUTOMATIONS);
  const [answers, setAnswers] = useState(STARTING_ANSWERS);
  const [team, setTeam] = useState(STARTING_TEAM);
  const [settings, setSettings] = useState(STARTING_SETTINGS);
  const [departments, setDepartments] = useState(STARTING_DEPARTMENTS);
  // checked = we've asked the server who's signed in (until then, pages
  // wait instead of sending you to the sign-in page).
  // userId = the real account that's signed in, or null.
  const [auth, setAuth] = useState({ checked: false, userId: null });
  const [demoId, setDemoId] = useState(readDemo);

  // When the app opens: ask the server if you're already signed in
  useEffect(() => {
    let cancelled = false;
    api("/auth/me")
      .then(({ user }) => {
        if (cancelled) return;
        setTeam((list) => withRealUser(list, user));
        setAuth({ checked: true, userId: user.id });
      })
      .catch(() => {
        if (!cancelled) setAuth({ checked: true, userId: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The signed-in person (null when nobody is), and the name written on
  // their replies and notes. Removed or not-yet-active people don't count.
  const meId = auth.userId ?? (DEMO_ALLOWED ? demoId : null);
  const me = team.find((m) => m.id === meId && m.status === "active") ?? null;
  // Signed in with a real account (not a demo one)?
  const realSession = Boolean(auth.userId);
  const myName = me?.name ?? "";

  // Everyone on the staff who can be given tickets: active members who
  // aren't customers. Every "Assigned to" list in the app uses these.
  const agents = team
    .filter((m) => m.role !== "customer" && m.status === "active")
    .map((m) => ({
      id: m.id,
      name: m.name,
      title: m.title ?? "",
      photo: m.photo,
      departments: m.departments,
    }));
  // Let every page see the current departments and agents
  syncDirectory(departments, agents);

  // ---------- Departments ----------

  // Is this name already taken? (not counting the department being renamed)
  function departmentNameTaken(name, exceptId) {
    const wanted = name.trim().toLowerCase();
    return departments.some(
      (d) => d.id !== exceptId && d.name.toLowerCase() === wanted,
    );
  }

  function addDepartment(name) {
    const department = { id: `d${Date.now().toString(36)}`, name: name.trim() };
    setDepartments((list) => [...list, department]);
    return department;
  }

  function renameDepartment(id, name) {
    setDepartments((list) =>
      list.map((d) => (d.id === id ? { ...d, name: name.trim() } : d)),
    );
  }

  // Deleting a department: its tickets go back to "No team yet", people
  // are taken off it, rules for it are switched off, and its Knowledge
  // Base answers stay but without a team. The last one can't be deleted.
  function deleteDepartment(id) {
    if (departments.length <= 1) return;
    setDepartments((list) => list.filter((d) => d.id !== id));
    setTickets((list) =>
      list.map((t) => (t.department === id ? { ...t, department: null } : t)),
    );
    setTeam((list) =>
      list.map((m) =>
        m.departments.includes(id)
          ? { ...m, departments: m.departments.filter((d) => d !== id) }
          : m,
      ),
    );
    setRules((list) =>
      list.map((r) => (r.department === id ? { ...r, enabled: false } : r)),
    );
    setAnswers((list) =>
      list.map((a) => (a.department === id ? { ...a, department: null } : a)),
    );
  }

  // ---------- Signing in and out ----------

  // Sign in with a real account. Throws an error with the server's
  // message (e.g. "That email and password don't match.") if it fails.
  async function signIn(email, password) {
    const { user } = await api("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setTeam((list) => withRealUser(list, user));
    setAuth({ checked: true, userId: user.id });
    setDemoId(null);
    saveDemo(null);
    return user;
  }

  // Try out an example person (only while running "npm run dev")
  function signInDemo(memberId) {
    if (!DEMO_ALLOWED) return;
    setDemoId(memberId);
    saveDemo(memberId);
  }

  function logout() {
    if (auth.userId) {
      // Ends the session on the server too. If that fails (offline), the
      // app still signs you out here.
      api("/auth/logout", { method: "POST" }).catch(() => {});
    }
    setAuth((a) => ({ ...a, userId: null }));
    setDemoId(null);
    saveDemo(null);
  }

  // Change your own password (real accounts). Throws with the server's
  // message if the current password is wrong or the new one too short.
  async function changePassword(currentPassword, newPassword) {
    await api("/auth/password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  }

  // An invited person sets their password: they become active and are
  // signed straight in. (Still the example version: real invites come
  // with the next backend step.)
  function acceptInvite(id, name) {
    const time = Date.now();
    updateMember(id, {
      name: name.trim(),
      status: "active",
      joinedAt: time,
      lastActiveAt: time,
    });
    signInDemo(id);
  }

  // ---------- Settings ----------

  // e.g. updateSettings("backup", { schedule: "weekly" })
  function updateSettings(section, changes) {
    setSettings((all) => ({
      ...all,
      [section]: { ...all[section], ...changes },
    }));
  }

  // ---------- Backup, restore and import ----------

  // Everything in the app, in one object, ready to save as a file
  function makeBackup() {
    const time = Date.now();
    const backupSettings = {
      ...settings,
      backup: { ...settings.backup, lastBackupAt: time },
    };
    setSettings(backupSettings);
    return {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: time,
      data: {
        tickets,
        customers,
        departments,
        team,
        rules,
        automations,
        answers,
        settings: backupSettings,
      },
    };
  }

  // Replaces everything with what's in a backup. Anything the backup
  // doesn't have is left as it is. The team is only replaced if the
  // backup still has you in it, so you can't lock yourself out.
  function restoreBackup(data) {
    setTickets(data.tickets);
    setCustomers(data.customers);
    if (data.departments?.length) setDepartments(data.departments);
    if (data.team?.some((m) => m.id === me?.id)) setTeam(data.team);
    if (data.rules) setRules(data.rules);
    if (data.automations) setAutomations(data.automations);
    if (data.answers) setAnswers(data.answers);
    if (data.settings) setSettings({ ...STARTING_SETTINGS, ...data.settings });
  }

  // Saves the result of a Freshdesk import (see freshdeskMapping.js).
  // Tickets keep a copy of their customer, so those are refreshed too.
  function saveImport(newCustomers, newTickets) {
    const byId = new Map(newCustomers.map((c) => [c.id, c]));
    setCustomers(newCustomers);
    setTickets(
      newTickets.map((t) => ({
        ...t,
        requester: byId.get(t.customerId) ?? t.requester,
      })),
    );
  }

  // ---------- Team ----------

  // Is this email already on the team (signed up or invited)?
  function findMemberByEmail(email) {
    const wanted = email.trim().toLowerCase();
    return team.find((m) => m.email === wanted);
  }

  // Adds someone as "invited". Later, the backend sends them an email
  // with a link to set their password, and they become "active".
  function inviteMember({ email, name, title, role, departments }) {
    const member = {
      id: `m${Date.now()}`,
      name: name.trim(),
      title: title.trim(),
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

  // `source` is where it came from: "agent" (made by staff) or "portal"
  // (sent by the customer from the customer portal)
  function addTicket({
    customer,
    subject,
    department,
    priority,
    dueBy,
    description,
    source = "agent",
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
      source,
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

  // A customer's star rating (1-5) and comment on a finished ticket.
  // Shows up on the Performance & Feedback page.
  function rateTicket(id, rating, comment) {
    setTickets((list) =>
      list.map((t) =>
        t.id === id
          ? {
              ...t,
              feedback: { rating, comment: comment.trim(), at: Date.now() },
            }
          : t,
      ),
    );
  }

  // Ticket Review: an Admin ticks off a finished ticket once they've checked
  // it (or unticks it). Recorded on the ticket and in its history.
  function markReviewed(id, reviewed) {
    const now = Date.now();
    setTickets((list) =>
      list.map((t) =>
        t.id === id
          ? {
              ...t,
              review: reviewed ? { by: myName, at: now } : null,
              messages: [
                ...t.messages,
                {
                  id: t.messages.length + 1,
                  kind: "event",
                  author: myName,
                  body: reviewed
                    ? "marked the ticket as reviewed"
                    : "took the review tick off",
                  at: now,
                },
              ],
            }
          : t,
      ),
    );
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
            // Picking up a ticket yourself reads "took the ticket"
            body:
              field === "assignee" && value === me?.id
                ? "took the ticket"
                : describeChange(field, value),
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
        agents,
        me,
        authChecked: auth.checked,
        realSession,
        demoAllowed: DEMO_ALLOWED,
        signIn,
        signInDemo,
        logout,
        changePassword,
        acceptInvite,
        rateTicket,
        markReviewed,
        findMemberByEmail,
        inviteMember,
        inviteCustomer,
        updateMember,
        resendInvite,
        removeMember,
        settings,
        updateSettings,
        departments,
        departmentNameTaken,
        addDepartment,
        renameDepartment,
        deleteDepartment,
        makeBackup,
        restoreBackup,
        saveImport,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
