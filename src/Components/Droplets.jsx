// The loading animation: three water drops falling one after another,
// each landing with a little splash (the drops' movement is in index.css,
// "Droplets"). Its size and colour come from className, like an icon:
//   <Droplets className="h-4 w-4" />               in a button
//   <Droplets className="h-10 w-10 text-brand" />  while a page loads
// With "reduce motion" switched on, the drops just sit still.
export default function Droplets({ className = "h-4 w-4", label = "Loading" }) {
  // A teardrop 6 wide, its point at the top, centred on x
  const drop = (x) =>
    `M${x} 6.5C${x + 1.8} 9.2 ${x + 3} 11 ${x + 3} 12.8a3 3 0 0 1-6 0C${x - 3} 11 ${x - 1.8} 9.2 ${x} 6.5Z`;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      className={`droplets shrink-0 ${className}`}
    >
      {[5, 12, 19].map((x, i) => (
        <g key={x} style={{ animationDelay: `${i * 0.18}s` }}>
          <ellipse
            className="droplet-splash"
            cx={x}
            cy="19.5"
            rx="3"
            ry="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
          <path
            className="droplet"
            d={drop(x)}
            fill="currentColor"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        </g>
      ))}
    </svg>
  );
}
