import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { DataContext } from "./useData";
import { api, setTabId } from "./api";
import { pausePush, resumePush } from "./push";
import { SLA_HOURS, syncDirectory } from "./data";

// ---------- Everything comes from the backend ----------
// Signing in, the team, departments, customers, tickets, the Knowledge
// Base, assignment rules, automations and settings all come from the
// server (see the server folder), which stores them in the database.

// App settings (Super Admin only), used until the server's copy has
// loaded. The server has the same defaults.
const STARTING_SETTINGS = {
  backup: {
    destination: "server", // where automatic backups go
    schedule: "daily", // "off", "daily" or "weekly"
    keep: 14, // how many old backups to keep
    lastBackupAt: null,
  },
  freshdesk: {
    domain: "", // e.g. "protonic" for protonic.freshdesk.com
  },
};

// Wraps the whole app and keeps everything the pages show in one place,
// loaded from (and saved to) the server
export default function DataProvider({ children }) {
  // All of these load from the server once you're signed in
  const [tickets, setTickets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [rules, setRules] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [team, setTeam] = useState([]);
  const [settings, setSettings] = useState(STARTING_SETTINGS);
  const [departments, setDepartments] = useState([]);
  // The bell: your latest notifications, newest first (staff only)
  const [notifications, setNotifications] = useState([]);
  // Who's on which page right now: [{ userId, path, since }]
  const [presence, setPresence] = useState([]);
  // SLA targets per priority, in hours (from the server)
  const [sla, setSlaState] = useState(() => structuredClone(SLA_HOURS));
  // checked = we've asked the server who's signed in (until then, pages
  // wait instead of sending you to the sign-in page).
  // userId = the account that's signed in, or null.
  const [auth, setAuth] = useState({ checked: false, userId: null });

  // Loads everything the person who just signed in is allowed to see.
  // Customers only get themselves and their own tickets. Rules and
  // automations are for Admins, settings for the Super Admin.
  async function loadDirectory(user) {
    const isCustomer = user.role === "customer";
    const isAdmin = user.role === "owner" || user.role === "admin";
    const [
      teamList,
      departmentList,
      customerList,
      ticketList,
      answerList,
      ruleList,
      automationList,
      settingsData,
      notificationList,
      slaTargets,
    ] = await Promise.all([
      isCustomer ? [user] : api("/team"),
      api("/departments"),
      api("/customers"),
      api("/tickets"),
      isCustomer ? [] : api("/answers"),
      isAdmin ? api("/rules") : [],
      isAdmin ? api("/automations") : [],
      user.role === "owner" ? api("/settings") : STARTING_SETTINGS,
      isCustomer ? [] : api("/notifications"),
      api("/sla"),
    ]);
    setTeam(teamList);
    setDepartments(departmentList);
    setCustomers(customerList);
    takeTicketList(ticketList);
    setAnswers(answerList);
    setRules(ruleList);
    setAutomations(automationList);
    setSettings(settingsData);
    setNotifications(notificationList);
    setSla(slaTargets);
  }

  // The SLA targets are also kept in data.js (SLA_HOURS), which the
  // pages read for due times, so both are updated together
  function setSla(targets) {
    for (const [p, hours] of Object.entries(targets)) {
      if (SLA_HOURS[p]) Object.assign(SLA_HOURS[p], hours);
    }
    setSlaState(structuredClone(targets));
  }

  // Changes the SLA targets (Admins and the Super Admin). Throws with the
  // server's message if it says no.
  async function updateSla(targets) {
    setSla(await api("/sla", { method: "PATCH", body: targets }));
  }

  // Signed in: load everything they need, then show the app
  async function startSignedIn(user) {
    try {
      await loadDirectory(user);
    } catch {
      setTeam([user]); // at least let them in
    }
    setAuth({ checked: true, userId: user.id });
    // This browser already allowed notifications: send yours here
    if (user.role !== "customer") resumePush();
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

  // ---------- The live connection (everyone signed in) ----------
  // One connection per open tab (see server/src/live.js). The server
  // uses it to say when something changed (someone else's edit, or an
  // automation), so every page stays up to date without refreshing.
  // Staff also get new notifications and who's on which page through
  // it; customers only hear about their own tickets. If it drops (e.g.
  // the server restarts), the browser reconnects by itself.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const connectionId = useRef(null);
  const isStaff = Boolean(me && me.role !== "customer");

  // Tell the server which page this tab is on
  function reportPage(path) {
    if (!connectionId.current) return;
    api("/live/presence", {
      method: "POST",
      body: { connectionId: connectionId.current, path },
    }).catch(() => {});
  }

  const signedIn = Boolean(me);
  useEffect(() => {
    if (!signedIn) return;
    const source = new EventSource("/api/live");
    let connectedBefore = false;

    source.addEventListener("hello", (e) => {
      connectionId.current = JSON.parse(e.data).connectionId;
      setTabId(connectionId.current);
      if (isStaff) reportPage(window.location.pathname);
      // Reconnected after a drop: catch up on anything missed
      if (connectedBefore) {
        if (isStaff)
          api("/notifications")
            .then(setNotifications)
            .catch(() => {});
        api("/tickets")
          .then(takeTicketList)
          .catch(() => {});
      }
      connectedBefore = true;
    });

    // Something changed somewhere else: load it again. Lots of changes
    // close together (e.g. an import) are loaded once, after they stop.
    const waiting = {};
    function later(key, load) {
      clearTimeout(waiting[key]);
      waiting[key] = setTimeout(() => load().catch(() => {}), 400);
    }
    source.addEventListener("changed", (e) => {
      const change = JSON.parse(e.data);
      // This tab made the change, so it already shows it
      if (change.tab && change.tab === connectionId.current) return;
      refresh(change, later);
    });

    source.addEventListener("presence", (e) => {
      setPresence(JSON.parse(e.data));
    });

    source.addEventListener("notification", (e) => {
      const n = JSON.parse(e.data);
      setNotifications((list) => [n, ...list.filter((x) => x.id !== n.id)]);
      // Load the ticket it's about, so the Inbox shows the change too
      if (n.ticketId) {
        api(`/tickets/${n.ticketId}`)
          .then(showTicket)
          .catch(() => {});
      }
    });

    return () => {
      source.close();
      connectionId.current = null;
      setTabId(null);
      setPresence([]);
    };
    // Only when someone signs in or out (the functions it uses only
    // change the lists, so they never go out of date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, me?.id]);

  // Loads again whatever the server said changed (see the live
  // connection above). `later` waits a moment, so a burst of changes
  // is loaded once.
  function refresh({ resource, id, deleted }, later) {
    const role = me?.role;
    const isAdmin = role === "owner" || role === "admin";
    // Customers are only told about their own tickets (and a restore)
    if (role === "customer" && resource !== "tickets" && resource !== "backup")
      return;
    switch (resource) {
      case "tickets": {
        const ticketId = Number(id);
        if (deleted) {
          setTickets((list) => list.filter((t) => t.id !== ticketId));
        } else if (ticketId) {
          later(`ticket-${ticketId}`, () =>
            api(`/tickets/${ticketId}`)
              .then(showTicket)
              .catch((err) => {
                // Deleted in the meantime
                if (err.status === 404)
                  setTickets((list) => list.filter((t) => t.id !== ticketId));
              }),
          );
        } else {
          later("tickets", () => api("/tickets").then(takeTicketList));
        }
        break;
      }
      case "customers":
        // Tickets keep a copy of their customer, so update those too.
        // A customer who was deleted takes their tickets and portal
        // login with them.
        later("customers", () =>
          api("/customers").then((list) => {
            setCustomers(list);
            const byId = new Map(list.map((c) => [c.id, c]));
            setTickets((all) =>
              all
                .filter((t) => byId.has(t.customerId))
                .map((t) => ({ ...t, requester: byId.get(t.customerId) })),
            );
            setTeam((all) =>
              all.filter((m) => !m.customerId || byId.has(m.customerId)),
            );
          }),
        );
        break;
      case "import":
        later("import", () =>
          Promise.all([api("/customers"), api("/tickets")]).then(
            ([customerList, ticketList]) => {
              setCustomers(customerList);
              takeTicketList(ticketList);
            },
          ),
        );
        break;
      case "answers":
        later("answers", () => api("/answers").then(setAnswers));
        break;
      case "rules":
        if (isAdmin) later("rules", () => api("/rules").then(setRules));
        break;
      case "automations":
        if (isAdmin)
          later("automations", () => api("/automations").then(setAutomations));
        break;
      case "team":
      case "me":
      case "invites":
        later("team", () => api("/team").then(setTeam));
        break;
      case "departments":
        later("departments", () => api("/departments").then(setDepartments));
        break;
      case "sla":
        later("sla", () => api("/sla").then(setSla));
        break;
      case "settings":
        if (role === "owner")
          later("settings", () => api("/settings").then(setSettings));
        break;
      case "backup":
        // A restore replaced everything: start fresh
        if (!String(id ?? "").startsWith("restore")) break;
        window.location.reload();
        break;
      default:
        break;
    }
  }

  // Moving to another page: tell the server
  useEffect(() => {
    if (isStaff) reportPage(pathname);
  }, [pathname, isStaff]);

  // Clicking a desktop notification while the app is open: public/sw.js
  // asks the app to go to that ticket
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function handleMessage(e) {
      if (e.data?.type === "open" && typeof e.data.path === "string") {
        navigate(e.data.path);
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [navigate]);

  // ---------- Notifications (the bell) ----------

  function markNotificationRead(id) {
    setNotifications((list) =>
      list.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    api(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }

  function markAllNotificationsRead() {
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    api("/notifications/read-all", { method: "POST" }).catch(() => {});
  }

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
    // Switch off its rules on the server too
    await Promise.all(
      rules
        .filter((r) => r.department === id && r.enabled)
        .map((r) =>
          api(`/rules/${r.id}`, { method: "PATCH", body: { enabled: false } }),
        ),
    );
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
      list.map((r) =>
        r.department === id ? { ...r, department: null, enabled: false } : r,
      ),
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
      // Stop sending this account's notifications to this browser, then
      // end the session on the server. If that fails (offline), the app
      // still signs you out here.
      pausePush().finally(() =>
        api("/auth/logout", { method: "POST" }).catch(() => {}),
      );
    }
    setAuth((a) => ({ ...a, userId: null }));
    setTeam([]);
    setCustomers([]);
    setTickets([]);
    setAnswers([]);
    setRules([]);
    setAutomations([]);
    setSettings(STARTING_SETTINGS);
    setNotifications([]);
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

  // "Forgot password": the new password from the emailed link, then
  // signed straight in (server/src/notices.js)
  async function resetPassword(token, password) {
    const { user } = await api(`/password/reset/${token}`, {
      method: "POST",
      body: { password },
    });
    await startSignedIn(user);
    return user;
  }

  // ---------- Settings ----------

  // e.g. updateSettings("backup", { schedule: "weekly" })
  // Shows the change straight away and saves it. If the server says no,
  // the change is undone and the reason shown.
  async function updateSettings(section, changes) {
    const before = settings;
    setSettings((all) => ({
      ...all,
      [section]: { ...all[section], ...changes },
    }));
    try {
      setSettings(
        await api(`/settings/${section}`, { method: "PATCH", body: changes }),
      );
    } catch (err) {
      setSettings(before);
      window.alert(`That setting wasn't saved: ${err.message}`);
    }
  }

  // ---------- Import ----------
  // (Backups are made and restored by the server: see BackupRestore.jsx)

  // Saves a Freshdesk import (worked out in freshdeskMapping.js) to the
  // database: customers first, then tickets, in batches so no single
  // request is too big. `onProgress` gets a short message to show.
  // Returns the counts from the server and anything it couldn't save.
  // Afterwards the customers and tickets are loaded again, so the page
  // shows exactly what's in the database.
  async function saveImport(newCustomers, newTickets, replace, onProgress) {
    const totals = {
      customers: { added: 0, updated: 0, skipped: 0 },
      tickets: { added: 0, updated: 0, skipped: 0 },
      problems: [],
    };

    async function send(path, key, list, batchSize, label) {
      for (let i = 0; i < list.length; i += batchSize) {
        onProgress?.(
          `Saving ${label}… ${Math.min(i + batchSize, list.length)} of ${list.length}`,
        );
        const r = await api(path, {
          method: "POST",
          body: { [key]: list.slice(i, i + batchSize), replace },
        });
        totals[key].added += r.added;
        totals[key].updated += r.updated;
        totals[key].skipped += r.skipped;
        totals.problems.push(...r.problems);
      }
    }

    // Only what the server needs: tickets keep a copy of their customer
    // on screen, but that doesn't need to be sent
    const ticketsToSend = newTickets.map((t) => {
      const copy = { ...t };
      delete copy.requester;
      return copy;
    });

    await send(
      "/import/customers",
      "customers",
      newCustomers,
      500,
      "customers",
    );
    // Tickets with their whole conversation, so smaller batches
    await send("/import/tickets", "tickets", ticketsToSend, 50, "tickets");

    onProgress?.("Loading what was saved…");
    const [customerList, ticketList] = await Promise.all([
      api("/customers"),
      api("/tickets"),
    ]);
    setCustomers(customerList);
    takeTicketList(ticketList);
    return totals;
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
  // tickets unassigned, so the tickets are loaded again afterwards.
  async function removeMember(id) {
    const member = team.find((m) => m.id === id);
    await api(`/team/${id}`, { method: "DELETE" });
    setTeam((list) => list.filter((m) => m.id !== id));
    if (member?.status === "active" && member.role !== "customer") {
      takeTicketList(await api("/tickets"));
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
  // These save to the database, then update the page. If the server says
  // no, they throw an error with its message.

  async function addAutomation(fields) {
    const automation = await api("/automations", {
      method: "POST",
      body: fields,
    });
    setAutomations((list) => [...list, automation]);
    return automation;
  }

  async function updateAutomation(id, changes) {
    const updated = await api(`/automations/${id}`, {
      method: "PATCH",
      body: changes,
    });
    setAutomations((list) => list.map((a) => (a.id === id ? updated : a)));
    return updated;
  }

  async function deleteAutomation(id) {
    await api(`/automations/${id}`, { method: "DELETE" });
    setAutomations((list) => list.filter((a) => a.id !== id));
  }

  // ---------- Assignment rules ----------
  // Same as automations: saved to the database first

  async function addRule(fields) {
    const rule = await api("/rules", { method: "POST", body: fields });
    setRules((list) => [...list, rule]);
    return rule;
  }

  async function updateRule(id, changes) {
    const updated = await api(`/rules/${id}`, {
      method: "PATCH",
      body: changes,
    });
    setRules((list) => list.map((r) => (r.id === id ? updated : r)));
    return updated;
  }

  async function deleteRule(id) {
    await api(`/rules/${id}`, { method: "DELETE" });
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

  // Deletes a customer for good, with all their tickets and their portal
  // login (Admins and the Super Admin). Returns how many tickets went.
  async function deleteCustomer(id) {
    const result = await api(`/customers/${id}`, { method: "DELETE" });
    setCustomers((list) => list.filter((c) => c.id !== id));
    setTickets((list) => list.filter((t) => t.customerId !== id));
    setTeam((list) => list.filter((m) => m.customerId !== id));
    return result.tickets;
  }

  // Which customer (if any) uses this email, as their main or an extra email?
  function findCustomerByEmail(email) {
    const wanted = email.trim().toLowerCase();
    return customers.find(
      (c) => c.email === wanted || (c.extraEmails ?? []).includes(wanted),
    );
  }

  // ---------- Tickets ----------
  // Every change goes to the server, which saves it and sends back the
  // whole updated ticket to show. If the server says no, these throw an
  // error with its message.

  // The list of every ticket, from the server. For staff it has no
  // conversations (they come when a ticket is opened, see
  // loadConversation), so a conversation already loaded is kept if the
  // ticket hasn't changed since.
  function takeTicketList(list) {
    setTickets((before) => {
      const loaded = new Map(
        before.filter((t) => t.messages).map((t) => [t.id, t]),
      );
      return list.map((t) => {
        const old = loaded.get(t.id);
        return !t.messages && old?.updatedAt === t.updatedAt
          ? { ...t, ...old }
          : t;
      });
    });
  }

  // Loads one ticket with its whole conversation (the ticket page asks
  // for it when it's opened)
  function loadConversation(id) {
    return api(`/tickets/${id}`).then(showTicket);
  }

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
  // attachmentIds: files already uploaded (see useAttachments.js)
  async function addTicket({
    customer,
    subject,
    department,
    priority,
    dueBy,
    description,
    attachmentIds = [],
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
          attachmentIds,
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
  // attachmentIds: files already uploaded (see useAttachments.js)
  // channel: how it reached the customer (staff only): "email" or
  // "whatsapp" for replies; "call", "whatsapp", "onsite" or "other" for
  // notes. See server/src/tickets.js.
  async function addMessage(
    id,
    kind,
    body,
    newStatus,
    attachmentIds = [],
    channel = null,
  ) {
    return showTicket(
      await api(`/tickets/${id}/messages`, {
        method: "POST",
        body: {
          kind,
          body,
          status: newStatus || undefined,
          attachmentIds,
          channel: channel || undefined,
        },
      }),
    );
  }

  // Delete an internal note (only its writer, or an Admin). Its files go
  // too; the people concerned get it in their bell.
  async function deleteNote(ticketId, messageId) {
    return showTicket(
      await api(`/tickets/${ticketId}/messages/${messageId}`, {
        method: "DELETE",
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
  // checked it (or unticks it). Recorded on the ticket.
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
        loadConversation,
        customers,
        addTicket,
        updateTicket,
        deleteTicket,
        addMessage,
        deleteNote,
        addCustomer,
        updateCustomer,
        deleteCustomer,
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
        resetPassword,
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
        saveImport,
        notifications,
        markNotificationRead,
        markAllNotificationsRead,
        presence,
        sla,
        updateSla,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
