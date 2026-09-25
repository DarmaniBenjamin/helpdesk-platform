import { PRIORITIES } from "../data";

// A colored dot per priority level
const DOT_COLORS = {
  1: "bg-slate-400",
  2: "bg-sky-500",
  3: "bg-amber-500",
  4: "bg-red-500",
};

export default function PriorityBadge({ priority }) {
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap text-sm ${priority === 4 ? "font-medium text-red-500" : ""}`}
    >
      <span className={`h-2 w-2 rounded-full ${DOT_COLORS[priority]}`} />
      {PRIORITIES[priority].label}
    </span>
  );
}
