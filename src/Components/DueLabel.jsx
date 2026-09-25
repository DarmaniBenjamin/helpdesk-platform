import { Clock, CircleCheck, TriangleAlert } from "lucide-react";
import { isDone, HOUR } from "../data";

// 45 min -> "45m", 5 hours -> "5h", 3 days -> "3d"
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// Works out what to show for a ticket's due time
function getDueInfo(ticket) {
  if (isDone(ticket)) {
    const onTime = ticket.resolvedAt <= ticket.dueBy;
    return {
      text: onTime ? "Met SLA" : "Missed SLA",
      icon: CircleCheck,
      className: onTime ? "text-brand" : "text-muted",
    };
  }

  const timeLeft = ticket.dueBy - Date.now();
  if (timeLeft < 0) {
    return {
      text: `Overdue ${formatDuration(-timeLeft)}`,
      icon: TriangleAlert,
      className: "font-medium text-red-500",
    };
  }
  if (timeLeft < 2 * HOUR) {
    return {
      text: `Due in ${formatDuration(timeLeft)}`,
      icon: Clock,
      className: "font-medium text-amber-600",
    };
  }
  return {
    text: `Due in ${formatDuration(timeLeft)}`,
    icon: Clock,
    className: "text-muted",
  };
}

// Shows "Due in 5h", "Overdue 2d" (red), "Met SLA" etc.
// Hovering shows the exact due date and time.
export default function DueLabel({ ticket }) {
  const { text, icon: Icon, className } = getDueInfo(ticket);
  const exact = new Date(ticket.dueBy).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <span
      title={`Due ${exact}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {text}
    </span>
  );
}
