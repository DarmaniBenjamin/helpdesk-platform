import { Crown, ShieldCheck, Headset, UserRound } from "lucide-react";

// Access levels: what someone is allowed to do in the app. This is
// separate from their job title (what they do at work, typed in freely)
// and their departments (which groups of work they're in).
//   owner    = Super Admin: the boss. Only one. Full access.
//   admin    = runs the day-to-day: tickets, people, departments, reports
//   agent    = does the work on tickets
//   customer = uses the customer portal
export const ROLES = {
  owner: {
    label: "Super Admin",
    description:
      "Full access to everything, including backups, settings and who is an Admin. There's only one.",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: Crown,
  },
  admin: {
    label: "Admin",
    description:
      "Creates tickets, invites and removes agents and customers, manages departments, rules, automations and reports.",
    badge: "bg-violet-50 text-violet-700 ring-violet-200",
    icon: ShieldCheck,
  },
  agent: {
    label: "Agent",
    description:
      "Works on tickets: replies, notes, status, and assigning tickets to themselves or anyone else.",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: Headset,
  },
  customer: {
    label: "Customer",
    description:
      "Signs in to the customer portal and can only see their own tickets.",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
    icon: UserRound,
  },
};

// Everyone except customers
export const STAFF_ROLES = ["owner", "admin", "agent"];
const ADMINS_UP = ["owner", "admin"];
const SUPER_ADMIN = ["owner"];

// What each access level can do. The key is used in the code with can()
// below; the label is shown in the table on the Team page. Later the
// backend checks exactly these same rules before saving anything.
export const PERMISSIONS = [
  {
    key: "workTickets",
    label: "Reply, add notes, change status and priority",
    roles: STAFF_ROLES,
  },
  {
    key: "assignTickets",
    label: "Assign tickets to themselves or anyone",
    roles: STAFF_ROLES,
  },
  { key: "customers", label: "Add and edit customers", roles: STAFF_ROLES },
  {
    key: "knowledge",
    label: "Use, add and edit Knowledge Base answers",
    roles: STAFF_ROLES,
  },
  { key: "createTickets", label: "Create tickets", roles: ADMINS_UP },
  {
    key: "team",
    label: "Invite and remove agents and customers",
    roles: ADMINS_UP,
  },
  {
    key: "departments",
    label: "Create departments and set job titles",
    roles: ADMINS_UP,
  },
  {
    key: "review",
    label: "Ticket Review: check up on open and closed tickets",
    roles: ADMINS_UP,
  },
  { key: "rules", label: "Assignment rules and automations", roles: ADMINS_UP },
  {
    key: "reports",
    label: "Reports and Performance & Feedback",
    roles: ADMINS_UP,
  },
  { key: "email", label: "Email Integration", roles: ADMINS_UP },
  { key: "admins", label: "Make, change or remove Admins", roles: SUPER_ADMIN },
  {
    key: "settings",
    label: "Backups, restore, Freshdesk import and settings",
    roles: SUPER_ADMIN,
  },
  {
    key: "ownTickets",
    label: "Send requests and see only their own tickets",
    roles: ["customer"],
  },
];

// Can someone with this access level do this? e.g. can(me.role, "reports")
export function can(role, key) {
  return PERMISSIONS.find((p) => p.key === key)?.roles.includes(role) ?? false;
}

// Which access levels you can give someone when inviting or editing.
// Only the Super Admin can make Admins. Customers are invited separately.
export function pickableRoles(myRole) {
  return can(myRole, "admins") ? ["admin", "agent"] : ["agent"];
}

// Can I change or remove this person? The Super Admin can manage everyone
// else; Admins can manage agents and customers, but not other Admins.
export function canManage(myRole, member) {
  if (member.role === "owner") return false;
  if (member.role === "admin") return can(myRole, "admins");
  return can(myRole, "team");
}

// A name to show for someone. Invited people might not have one yet.
export function displayName(member) {
  return member.name || member.email;
}
