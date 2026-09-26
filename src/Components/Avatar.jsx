// A circle with someone's photo, or their initials if they don't have one,
// e.g. "Jada Mitchell" -> "JM". Pass `status` (a color class like
// "bg-emerald-500") to show a small dot in the corner.
const COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-teal-600",
];

const SIZES = {
  sm: { circle: "h-8 w-8 text-xs", dot: "h-2.5 w-2.5 ring-2" },
  md: { circle: "h-10 w-10 text-sm", dot: "h-3 w-3 ring-2" },
  lg: { circle: "h-24 w-24 text-2xl", dot: "h-5 w-5 ring-4" },
};

export default function Avatar({ name, photo, size = "md", status }) {
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
  const { circle, dot } = SIZES[size];

  return (
    <span className="relative inline-flex shrink-0">
      {photo ? (
        <img
          src={photo}
          alt={name}
          className={`${circle} rounded-full object-cover`}
        />
      ) : (
        <span
          className={`flex items-center justify-center rounded-full font-medium text-white ${circle} ${COLORS[colorIndex]}`}
        >
          {initials}
        </span>
      )}
      {status && (
        <span
          className={`absolute bottom-0 right-0 rounded-full ring-white ${dot} ${status}`}
        />
      )}
    </span>
  );
}
