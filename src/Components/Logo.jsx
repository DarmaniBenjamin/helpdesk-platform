// The Uplink logo: an arrow rising from a connection point, on a green
// rounded square. Drawn in code (no image file), so it's sharp at any
// size. The same drawing is in public/favicon.svg for the browser tab.
//   className  its size, e.g. "h-8 w-8"
//   light      a white square with a green arrow, for green backgrounds
export default function Logo({ className = "h-8 w-8", light = false }) {
  const fg = light ? "#00a874" : "#fff";
  return (
    <svg
      viewBox="0 0 64 64"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label="Uplink logo"
    >
      <defs>
        <linearGradient id="uplink-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#19d193" />
          <stop offset="1" stopColor="#00976a" />
        </linearGradient>
      </defs>
      <rect
        width="64"
        height="64"
        rx="16"
        fill={light ? "#fff" : "url(#uplink-logo-bg)"}
      />
      <path
        d="M32 39.5V20M21 30.5 32 19.5 43 30.5"
        fill="none"
        stroke={fg}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="48" r="3.6" fill={fg} />
      <path
        d="M19.5 48h5.5M39 48h5.5"
        stroke={fg}
        strokeOpacity=".55"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
