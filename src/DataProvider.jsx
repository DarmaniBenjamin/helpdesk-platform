import { useEffect, useState } from "react";
import { DataContext } from "./useData";
import { api } from "./api";
import { syncDirectory } from "./data";
import { BACKUP_APP, BACKUP_VERSION } from "./Components/backupUtils";

// ---------- What comes from the backend ----------
// Signing in, the team, departments, customers, tickets and the Knowledge
// Base come from the server (see the server folder), which stores them in
// the database. Rules, automations and settings are still example data
// for now; they move to the database next.

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
  // Tickets, customers, Knowledge Base answers, the team and departments
  // load from the server once you're signed in
  const [tickets, setTickets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [rules, setRules] = useState(STARTING_RULES);
  const [automations, setAutomations] = useState(STARTING_AUTOMATIONS);
  const [team, setTeam] = useState([]);
  const [settings, setSettings] = useState(STARTING_SETTINGS);
  const [departments, setDepartments] = useState([]);
  // checked = we've asked the server who's signed in (until then, pages
  // wait instead of sending you to the sign-in page).
  // userId = the account that's signed in, or null.
  const [auth, setAuth] = useState({ checked: false, userId: null });

  // Loads everything for the person who just signed in. Customers only
  // get themselves and their own tickets (they never see the staff list,
  // other customers, internal notes, history lines or the Knowledge Base).
  async function loadDirectory(user) {
    const isCustomer = user.role === "customer";
    const [teamList, departmentList, customerList, ticketList, answerList] =
      await Promise.all([
        isCustomer ? [user] : api("/team"),
        api("/departments"),
        api("/customers"),
        api("/tickets"),
        isCustomer ? [] : api("/answers"),
      ]);
    setTeam(teamList);
    setDepartments(departmentList);
    setCustomers(customerList);
    setTickets(ticketList);
    setAnswers(answerList);

    // The example rules were assigned to example people who don't exist
    // any more, so those go back to "anyone on the team"
    const ids = new Set(teamList.map((m) => m.id));
    setRules((list) =>
      list.map((r) =>
        r.agent && !ids.has(r.agent) ? { ...r, agent: null } : r,
      ),
    );
  }

  // Signed in: load everything they need, then show the app
  async function startSignedIn(user) {
    try {
      await loadDirectory(user);
    } catch {
      setTeam([user]); // at least let them in
    }
    setAuth({ checked: true, userId: user.id });
  }

  // When the app opens: ask the server if you're already signed in
  useEffect(() => {
    let cancelled = false;
    api("/auth/me")
      .then(({ user }) => {
        if (!cancelled) return startSignedIn(user);
      })
      .catch(() => {
        if (!cancelled) setAuth({ checked: true, userId: null });
      });
    return () => {
      cancelled = true;
    };
    // Only once, when the app first opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The signed-in person (null when nobody is)
  const me = team.find((m) => m.id === auth.userId) ?? null;

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

  // These save to the database, then update the page. If the server says
  // no (e.g. the name is taken), they throw an error with its message.
  async function addDepartment(name) {
    const department = await api("/departments", {
      method: "POST",
      body: { name },
    });
    setDepartments((list) => [...list, department]);
    return department;
  }

  async function renameDepartment(id, name) {
    const updated = await api(`/departments/${id}`, {
      method: "PATCH",
      body: { name },
    });
    setDepartments((list) => list.map((d) => (d.id === id ? updated : d)));
  }

  // Deleting a department: its tickets go back to "No team yet", people
  // are taken off it, rules for it are switched off, and its Knowledge
  // Base answers stay but without a team. The last one can't be deleted.
  async function deleteDepartment(id) {
    await api(`/departments/${id}`, { method: "DELETE" });
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

  // Sign in. Throws an error with the server's message (e.g. "That email
  // and password don't match.") if it fails.
  async function signIn(email, password) {
    const { user } = await api("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await startSignedIn(user);
    return user;
  }

  function logout() {
    if (auth.userId) {
      // Ends the session on the server. If that fails (offline), the app
      // still signs you out here.
      api("/auth/logout", { method: "POST" }).catch(() => {});
    }
    setAuth((a) => ({ ...a, userId: null }));
    setTeam([]);
    setCustomers([]);
    setTickets([]);
    setAnswers([]);
  }

  // Change your own password. Throws with the server's message if the
  // current password is wrong or the new one too short.
  async function changePassword(currentPassword, newPassword) {
    await api("/auth/password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  }

  // Someone opens their invite link, picks a name and password, and is
  // signed straight in
  async function acceptInvite(token, name, password) {
    const { user } = await api(`/invites/${token}/accept`, {
      method: "POST",
      body: { name, password },
    });
    await startSignedIn(user);
    return user;
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
  // doesn't have is left as it is. Tickets, customers, the Knowledge Base,
  // the team and departments aren't replaced: they live in the database
  // now (database backups are set up in a later step).
  function restoreBackup(data) {
    if (data.rules) setRules(data.rules);
    if (data.automations) setAutomations(data.automations);
    if (data.settings) setSettings({ ...STARTING_SETTINGS, ...data.settings });
  }

  // Saves the result of a Freshdesk import (see freshdeskMapping.js).
  // Tickets keep a copy of their customer, so those are refreshed too.
  // (For now this only changes what's on screen. Importing into the
  // database is the next step.)
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

  // Invites someone. Returns { member, token }: the token makes the invite
  // link (/welcome/<token>), which the Admin copies and sends until
  // invite emails are set up.
  async function inviteMember({ email, name, title, role, departments }) {
    const result = await api("/team/invite", {
      method: "POST",
      body: { email, name, title, role, departments },
    });
    setTeam((list) => [...list, result.member]);
    return result;
  }

  // A fresh invite link for someone who hasn't signed up yet (Resend or
  // Copy invite link). The old link stops working. Returns the token.
  async function newInviteLink(id) {
    const { member, token } = await api(`/team/${id}/invite-link`, {
      method: "POST",
    });
    setTeam((list) => list.map((m) => (m.id === id ? member : m)));
    return token;
  }

  // Saves changes to someone. Your own name, email, phone and photo go
  // through "My profile"; other people's name, job title, access level
  // and departments through the Team page. Throws with the server's
  // message if it's not allowed or the email is taken.
  async function updateMember(id, changes) {
    const updated =
      id === me?.id
        ? await api("/me", { method: "PATCH", body: changes })
        : await api(`/team/${id}`, { method: "PATCH", body: changes });
    setTeam((list) => list.map((m) => (m.id === id ? updated : m)));
    // A customer's name, email and phone also live on their customer
    // record (the server keeps both the same)
    if (updated.customerId) {
      const { name, email, phone } = updated;
      setCustomers((list) =>
        list.map((c) =>
          c.id === updated.customerId ? { ...c, name, email, phone } : c,
        ),
      );
    }
    return updated;
  }

  // Takes someone off the team (or cancels their invite). Their sign-in
  // stops working straight away. The server makes their unfinished
  // tickets unassigned (with a line in each ticket's history saying
  // why), so the tickets are loaded again afterwards.
  async function removeMember(id) {
    const member = team.find((m) => m.id === id);
    await api(`/team/${id}`, { method: "DELETE" });
    setTeam((list) => list.filter((m) => m.id !== id));
    if (member?.status === "active" && member.role !== "customer") {
      setTickets(await api("/tickets"));
    }
  }

  // ---------- Saved answers (knowledge base) ----------
  // These save to the database, then update the page. If the server says
  // no, they throw an error with its message.

  // A new answer: { title, problem, solution, keywords, department },
  // plus ticketId and source: "note" when it's saved from a ticket's note
  async function addAnswer(fields) {
    const answer = await api("/answers", { method: "POST", body: fields });
    setAnswers((list) => [answer, ...list]); // newest first
    return answer;
  }

  async function updateAnswer(id, changes) {
    const updated = await api(`/answers/${id}`, {
      method: "PATCH",
      body: changes,
    });
    setAnswers((list) => list.map((a) => (a.id === id ? updated : a)));
    return updated;
  }

  async function deleteAnswer(id) {
    await api(`/answers/${id}`, { method: "DELETE" });
    setAnswers((list) => list.filter((a) => a.id !== id));
  }

  // Count how often an answer gets copied, so the most useful ones can
  // rise to the top. Shown straight away; if saving fails it doesn't
  // matter much, so nothing else happens.
  function recordAnswerUse(id) {
    setAnswers((list) =>
      list.map((a) => (a.id === id ? { ...a, uses: a.uses + 1 } : a)),
    );
    api(`/answers/${id}/use`, { method: "POST" }).catch(() => {});
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

  // Saves a new customer to the database. Throws with the server's
  // message if their email is already used by another customer.
  async function addCustomer(fields) {
    const customer = await api("/customers", {
      method: "POST",
      body: {
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        company: fields.company, // empty means an individual
      },
    });
    setCustomers((list) => [customer, ...list]);
    return customer;
  }

  // Saves changes to a customer (name, business, emails, phones)
  async function updateCustomer(id, changes) {
    const updated = await api(`/customers/${id}`, {
      method: "PATCH",
      body: changes,
    });
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
    return updated;
  }

  // Gives a customer access to the customer portal. Returns
  // { member, token }, like inviting staff.
  async function inviteCustomer(customerId) {
    const result = await api(`/customers/${customerId}/invite`, {
      method: "POST",
    });
    setTeam((list) => [...list, result.member]);
    return result;
  }

  // Which customer (if any) uses this email, as their main or an extra email?
  function findCustomerByEmail(email) {
    const wanted = email.trim().toLowerCase();
    return customers.find(
      (c) => c.email === wanted || (c.extraEmails ?? []).includes(wanted),
    );
  }

  // ---------- Tickets ----------
  // Every change goes to the server, which saves it, writes the ticket's
  // history, and sends back the whole updated ticket to show. If the
  // server says no, these throw an error with its message.

  // Puts the server's copy of a ticket on screen
  function showTicket(ticket) {
    setTickets(
      (list) =>
        list.some((t) => t.id === ticket.id)
          ? list.map((t) => (t.id === ticket.id ? ticket : t))
          : [ticket, ...list], // new tickets go first
    );
    return ticket;
  }

  // A new ticket. Admins pick the customer, department, priority and due
  // time; a customer sending a request from the portal only gives the
  // subject and description (the server fills in the rest).
  async function addTicket({
    customer,
    subject,
    department,
    priority,
    dueBy,
    description,
  }) {
    return showTicket(
      await api("/tickets", {
        method: "POST",
        body: {
          customerId: customer?.id,
          subject,
          department,
          priority,
          dueBy,
          description,
        },
      }),
    );
  }

  // Change fields on a ticket, e.g. updateTicket(4819, { status: "resolved" }).
  // Fields: status, priority, department, assignee, dueBy
  async function updateTicket(id, changes) {
    return showTicket(
      await api(`/tickets/${id}`, { method: "PATCH", body: changes }),
    );
  }

  // Add a reply ("agent") or internal note ("note"), and optionally change
  // the status at the same time. Customers' replies are always "customer".
  async function addMessage(id, kind, body, newStatus) {
    return showTicket(
      await api(`/tickets/${id}/messages`, {
        method: "POST",
        body: { kind, body, status: newStatus || undefined },
      }),
    );
  }

  // A customer's star rating (1-5) and comment on a finished ticket.
  // Shows up on the Performance & Feedback page.
  async function rateTicket(id, rating, comment) {
    return showTicket(
      await api(`/tickets/${id}/feedback`, {
        method: "POST",
        body: { rating, comment },
      }),
    );
  }

  // Ticket Review: an Admin ticks off a finished ticket once they've
  // checked it (or unticks it). Recorded on the ticket and in its history.
  async function markReviewed(id, reviewed) {
    return showTicket(
      await api(`/tickets/${id}/review`, {
        method: "POST",
        body: { reviewed },
      }),
    );
  }

  // Delete a ticket for good, with its whole conversation, notes and
  // history. Knowledge Base answers saved from it stay, but stop linking
  // to it. Admins and the Super Admin only.
  async function deleteTicket(id) {
    await api(`/tickets/${id}`, { method: "DELETE" });
    setTickets((list) => list.filter((t) => t.id !== id));
    setAnswers((list) =>
      list.map((a) => (a.ticketId === id ? { ...a, ticketId: null } : a)),
    );
  }

  return (
    <DataContext.Provider
      value={{
        tickets,
        customers,
        addTicket,
        updateTicket,
        deleteTicket,
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
        signIn,
        logout,
        changePassword,
        acceptInvite,
        rateTicket,
        markReviewed,
        findMemberByEmail,
        inviteMember,
        inviteCustomer,
        newInviteLink,
        updateMember,
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
