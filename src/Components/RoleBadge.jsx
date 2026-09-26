import { ROLES } from "./teamRoles";

// The colored role pill, e.g. "Admin"
export default function RoleBadge({ role }) {
  const { label, badge, icon } = ROLES[role];
  const Icon = icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${badge}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
