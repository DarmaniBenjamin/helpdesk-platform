// A circle with someone's photo, or their initials if they don't have one,
// e.g. "Jada Mitchell" -> "JM"
const COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-teal-600",
];

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-24 w-24 text-2xl",
};

export default function Avatar({ name, photo, size = "md" }) {
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
  const sizeClass = SIZES[size];

  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className={`shrink-0 rounded-full object-cover ${sizeClass}`}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-medium text-white ${sizeClass} ${COLORS[colorIndex]}`}
    >
      {initials}
    </span>
  );
}
