import { Crown, ShieldCheck, Eye, Headset } from "lucide-react";

// The roles someone on the team can have.
// "owner" is the person who set up the helpdesk. There's only one,
// and they can't be removed. The other three can be given out freely.
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
};

// The roles you can pick when inviting or editing someone (not "owner")
export const PICKABLE_ROLES = ["admin", "supervisor", "agent"];

// What each role is allowed to do. Shown as a table on the Team page.
// Later, the backend will check these same rules before saving anything.
const EVERYONE = ["owner", "admin", "supervisor", "agent"];
const SUPERVISORS_UP = ["owner", "admin", "supervisor"];
const ADMINS_UP = ["owner", "admin"];

export const PERMISSIONS = [
  { label: "Answer and update tickets", roles: EVERYONE },
  { label: "Add and edit customers", roles: EVERYONE },
  { label: "Use and add Knowledge Base answers", roles: EVERYONE },
  { label: "Reassign tickets to anyone", roles: SUPERVISORS_UP },
  { label: "Edit and delete Knowledge Base answers", roles: SUPERVISORS_UP },
  { label: "See reports and performance", roles: SUPERVISORS_UP },
  { label: "Manage assignment rules and automations", roles: ADMINS_UP },
  { label: "Invite, change and remove team members", roles: ADMINS_UP },
  { label: "Change settings and email integration", roles: ADMINS_UP },
  { label: "Transfer ownership", roles: ["owner"] },
];

// A name to show for someone. Invited people might not have one yet.
export function displayName(member) {
  return member.name || member.email;
}
