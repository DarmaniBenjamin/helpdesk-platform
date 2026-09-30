import { useEffect, useState } from "react";
import { ThemeToggleButton } from "./ThemeToggle";
import Logo from "./Logo";
import { APP_NAME } from "../brand";

// The points of the network pictures, like devices on a network, each
// linked to the middle (the "uplink"). Coordinates are in a 400 × 400
// box, with the middle at 200, 200.
const PANEL_NODES = [
  [70, 90],
  [200, 40],
  [330, 80],
  [365, 210],
  [320, 335],
  [195, 365],
  [70, 320],
  [35, 200],
];
// Behind the sign-in form: spread wider, out towards the edges, so the
// form in the middle stays clear
const FORM_NODES = [
  [30, 40],
  [150, 10],
  [300, 25],
  [385, 110],
  [390, 270],
  [330, 385],
  [175, 395],
  [40, 360],
  [10, 215],
];
const CENTRE = [200, 200];

// A network picture: points linked to the middle, with small dots
// travelling along the links towards the centre, over and over. It's
// drawn in the text colour of whatever it sits in (white on the green
// panel, green behind the form).
//   nodes  the points (see above)
//   faint  much lighter, for behind the form
//   fill   stretch to cover the whole area instead of staying square
// Anyone with "reduce motion" switched on gets it without the moving dots.
function Network({ nodes, faint = false, fill = false }) {
  const [still] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const o = faint ? 0.4 : 1; // how strong everything is
  const ring = nodes.map((node, i) => [node, nodes[(i + 1) % nodes.length]]);
  return (
    <svg
      viewBox="0 0 400 400"
      preserveAspectRatio={fill ? "xMidYMid slice" : "xMidYMid meet"}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {ring.map(([a, b], i) => (
        <line
          key={`r${i}`}
          x1={a[0]}
          y1={a[1]}
          x2={b[0]}
          y2={b[1]}
          stroke="currentColor"
          strokeOpacity={0.1 * o}
          strokeWidth="1"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <line
            x1={x}
            y1={y}
            x2={CENTRE[0]}
            y2={CENTRE[1]}
            stroke="currentColor"
            strokeOpacity={0.18 * o}
            strokeWidth="1.2"
          />
          <circle
            cx={x}
            cy={y}
            r="5"
            fill="currentColor"
            fillOpacity={0.35 * o}
          />
          <circle
            cx={x}
            cy={y}
            r="11"
            fill="currentColor"
            fillOpacity={0.08 * o}
          />
          {!still && (
            <circle r="2.6" fill="currentColor">
              <animateMotion
                dur={faint ? "4.5s" : "3.2s"}
                begin={`${i * 0.5}s`}
                repeatCount="indefinite"
                path={`M${x},${y} L${CENTRE[0]},${CENTRE[1]}`}
              />
              <animate
                attributeName="opacity"
                values={`0;${0.9 * o};${0.9 * o};0`}
                keyTimes="0;0.15;0.8;1"
                dur={faint ? "4.5s" : "3.2s"}
                begin={`${i * 0.5}s`}
                repeatCount="indefinite"
              />
            </circle>
          )}
        </g>
      ))}
    </svg>
  );
}

// The frame for the sign-in and invite pages: a green welcome panel on the
// left (big screens only) and the form on the right. The panel is the
// logo in the middle of a moving network picture; a much fainter one
// sits behind the form. Things come in with short animations (index.css).
export default function AuthShell({ title, children }) {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);

  return (
    // grid-cols-1 (not just "grid") stops long text, like an email address,
    // from stretching the page wider than the phone screen
    <div className="relative grid min-h-dvh grid-cols-1 bg-page lg:grid-cols-2">
      {/* Light / dark switch in the top corner */}
      <div className="absolute right-3 top-3 z-10">
        <ThemeToggleButton />
      </div>

      {/* Welcome panel */}
      <div className="relative hidden overflow-hidden bg-brand text-white lg:flex lg:flex-col lg:items-center lg:justify-center">
        {/* The network, as big as fits, with the logo at its centre */}
        <div className="animate-fade-in relative aspect-square w-[min(80%,34rem)]">
          <Network nodes={PANEL_NODES} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-rise-in wait-2 rounded-[1.4rem] shadow-2xl shadow-black/20">
              <Logo light className="h-24 w-24" />
            </div>
          </div>
        </div>

        <p className="animate-rise-in wait-3 -mt-2 text-3xl font-semibold tracking-tight">
          {APP_NAME}
        </p>

        <p className="absolute bottom-8 text-sm text-white/70">
          © {new Date().getFullYear()} {APP_NAME}
        </p>
      </div>

      {/* The form, with a faint green network behind it that fills the
          whole side (on phones, the whole screen) */}
      {/* Phones: starts near the top. Bigger screens: centred. */}
      <div className="relative flex min-w-0 flex-col items-center overflow-hidden px-5 pb-10 pt-12 sm:justify-center sm:px-6 sm:py-10">
        <div className="animate-fade-in pointer-events-none absolute inset-0 text-brand">
          <Network nodes={FORM_NODES} faint fill />
        </div>

        <div className="relative mb-8 flex items-center gap-2.5 lg:hidden">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-semibold">{APP_NAME}</span>
        </div>
        {/* The form rises into place */}
        <div className="animate-rise-in relative w-full max-w-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
