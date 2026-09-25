// A circle with someone's initials, e.g. "Jada Mitchell" -> "JM"
const COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-teal-600",
];

export default function Avatar({ name, size = "md" }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // The same name always gets the same color
  const colorIndex =
    [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) %
    COLORS.length;
  const sizeClass = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-medium text-white ${sizeClass} ${COLORS[colorIndex]}`}
    >
      {initials}
    </span>
  );
}
