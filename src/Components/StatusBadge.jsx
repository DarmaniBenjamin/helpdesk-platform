import { STATUSES } from "../data";

// The colored status pill, used anywhere a ticket's status is shown
export default function StatusBadge({ status }) {
  const { label, badge } = STATUSES[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${badge}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
