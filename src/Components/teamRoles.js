import { Crown, ShieldCheck, Eye, Headset, UserRound } from "lucide-react";

// The roles someone who can sign in can have.
// "owner" is the person who set up the helpdesk. There's only one,
// and they can't be removed. Admin, supervisor and agent are your staff.
// "customer" is for your customers, who sign in to the customer portal.
export const ROLES = {
  owner: {
    label: "Owner",
    description: "Full access. Set up the helpdesk and can't be removed.",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: Crown,
  },
  admin: {
    label: "Admin",
    description:
      "Everything a supervisor can do, plus managing the team, rules, automations and settings.",
    badge: "bg-violet-50 text-violet-700 ring-violet-200",
    icon: ShieldCheck,
  },
  supervisor: {
    label: "Supervisor",
    description:
      "Everything an agent can do, plus reassigning tickets, reports and editing the Knowledge Base.",
    badge: "bg-sky-50 text-sky-700 ring-sky-200",
    icon: Eye,
  },
  agent: {
    label: "Agent",
    description:
      "Answers and updates tickets, adds customers and uses the Knowledge Base.",
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
export const STAFF_ROLES = ["owner", "admin", "supervisor", "agent"];

// The roles you can pick when inviting or editing a staff member
// (not "owner", and customers are invited separately)
export const PICKABLE_ROLES = ["admin", "supervisor", "agent"];

// What each role is allowed to do. Shown as a table on the Team page.
// Later, the backend will check these same rules before saving anything.
const EVERYONE = [...STAFF_ROLES, "customer"];
const SUPERVISORS_UP = ["owner", "admin", "supervisor"];
const ADMINS_UP = ["owner", "admin"];

export const PERMISSIONS = [
  { label: "Open new tickets", roles: EVERYONE },
  { label: "View only their own tickets", roles: ["customer"] },
  { label: "See every ticket", roles: STAFF_ROLES },
  { label: "Answer and update tickets", roles: STAFF_ROLES },
  { label: "Add and edit customers", roles: STAFF_ROLES },
  { label: "Use and add Knowledge Base answers", roles: STAFF_ROLES },
  { label: "Reassign tickets to anyone", roles: SUPERVISORS_UP },
  { label: "Edit and delete Knowledge Base answers", roles: SUPERVISORS_UP },
  { label: "See reports and performance", roles: SUPERVISORS_UP },
  { label: "Manage assignment rules and automations", roles: ADMINS_UP },
  { label: "Invite, change and remove team members", roles: ADMINS_UP },
  { label: "Change settings and email integration", roles: ADMINS_UP },
  { label: "Transfer ownership", roles: ["owner"] },
];

// Whether a staff member is around to take tickets. Shown as a colored dot
// on their photo. Later, assignment rules can skip people who are away.
export const AVAILABILITY = {
  available: {
    label: "Available",
    hint: "Ready to take tickets",
    dot: "bg-emerald-500",
  },
  busy: {
    label: "Busy",
    hint: "Working, but don't send me more",
    dot: "bg-red-500",
  },
  away: {
    label: "Away",
    hint: "Out of office or on a break",
    dot: "bg-amber-400",
  },
};

// A name to show for someone. Invited people might not have one yet.
export function displayName(member) {
  return member.name || member.email;
}
