import { STATUSES } from "../../data";

// Customers see friendlier words than the team does,
// e.g. "Waiting on Customer" becomes "Waiting on you"
const CUSTOMER_LABELS = {
  open: "Open",
  pending: "In progress",
  waiting: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

export default function PortalStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUSES[status].badge}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CUSTOMER_LABELS[status]}
    </span>
  );
}
