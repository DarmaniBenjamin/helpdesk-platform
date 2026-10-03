import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The animation after you sign in, while your tickets and team load:
//   1. green liquid spills onto the middle of the screen
//   2. it gathers itself up into the Uplink arrow (still looking liquid)
//   3. the arrow bobs gently until everything has loaded
//   4. it crouches for a split second, then shoots up off the top of the
//      screen, the puddle splashes, and the app appears
// If the password was wrong, it quickly drains away instead and the form
// shows the message.
//
// The "liquid" look comes from an SVG filter ("goo"): it blurs the shapes
// together and then sharpens the edges again, so anything touching melts
// into one blob, like water.
//
//   status       "loading", "done" (signed in) or "failed"
//   onFinished   called once the arrow has left the screen
//   onCancelled  called once it has drained away after "failed"

const FORM_TIME = 1150; // ms until the arrow has fully formed
const SHOOT_TIME = 700; // ms for the shoot-up and fade

const styles = `
.sia { animation: sia-in 0.2s ease-out backwards; }
.sia.sia-drain { animation: sia-out 0.25s ease-in forwards; }
.sia.sia-shoot { animation: sia-out 0.3s ease-in 0.42s forwards; }
.sia svg * { transform-box: fill-box; }

/* 1. The spill: spreads out wide, wobbles, then pulls in as the liquid
      rises into the arrow */
.sia-puddle { transform-origin: center; animation: sia-spill 1.15s cubic-bezier(.3,1.4,.5,1) forwards; }
@keyframes sia-spill {
  0% { transform: scale(0, 0.4); }
  30% { transform: scale(1.15, 1.1); }
  42% { transform: scale(0.95, 1); }
  100% { transform: scale(0.5, 0.75); }
}

/* Little drops bubbling up out of the puddle while it waits */
.sia-drop { transform-origin: center; opacity: 0; animation: sia-bubble 1.4s ease-in-out infinite; }
.sia-drop:nth-of-type(2) { animation-delay: 0.45s; }
.sia-drop:nth-of-type(3) { animation-delay: 0.9s; }
@keyframes sia-bubble {
  0% { opacity: 0; transform: translateY(0) scale(0.4); }
  20% { opacity: 1; }
  50% { transform: translateY(-26px) scale(1); }
  100% { opacity: 0; transform: translateY(0) scale(0.5); }
}

/* 2. The arrow forms: the stem rises out of the puddle, then the head
      pops open at the top */
.sia-stem { transform-origin: 50% 100%; animation: sia-rise 0.6s cubic-bezier(.3,1.3,.5,1) 0.4s backwards; }
@keyframes sia-rise { from { transform: scaleY(0); } }
.sia-head { transform-origin: 50% 0%; animation: sia-pop 0.4s cubic-bezier(.3,1.6,.5,1) 0.8s backwards; }
@keyframes sia-pop { from { transform: scale(0, 0); } }

/* 3. Waiting: a gentle bob */
.sia-arrow { animation: sia-bob 1.6s ease-in-out 1.15s infinite; }
@keyframes sia-bob { 50% { transform: translateY(-6px); } }

/* 4. Lift-off: a quick crouch, then up and away, stretching as it goes */
.sia-shoot .sia-arrow { animation: sia-launch 0.7s cubic-bezier(.55,0,.9,.35) forwards; }
@keyframes sia-launch {
  0% { transform: translateY(0) scaleY(1); }
  18% { transform: translateY(14px) scaleY(0.86); }
  100% { transform: translateY(-140vh) scaleY(1.7); }
}
.sia-shoot .sia-puddle { animation: sia-settle 0.5s ease-out forwards; }
@keyframes sia-settle {
  0% { transform: scale(0.5, 0.75); }
  25% { transform: scale(1.25, 0.6); }
  100% { transform: scale(0, 0); opacity: 0; }
}
.sia-shoot .sia-drop { animation: none; opacity: 0; }

/* The splash: drops flying up and out as the arrow leaves */
.sia-splash { opacity: 0; transform-origin: center; }
.sia-shoot .sia-splash { animation: sia-fly 0.55s cubic-bezier(.2,.8,.4,1) 0.1s forwards; }
@keyframes sia-fly {
  0% { opacity: 1; transform: translate(0, 0) scale(1); }
  100% { opacity: 0; transform: translate(var(--x), var(--y)) scale(0.3); }
}

/* A streak left behind as it shoots up */
.sia-trail { opacity: 0; transform-origin: 50% 100%; }
.sia-shoot .sia-trail { animation: sia-streak 0.6s ease-out 0.12s forwards; }
@keyframes sia-streak {
  0% { opacity: 0; transform: scaleY(0.2); }
  30% { opacity: 0.5; transform: scaleY(1); }
  100% { opacity: 0; transform: scaleY(1.4) translateY(-60px); }
}

.sia-text { animation: sia-in 0.4s ease-out 0.9s backwards; }
.sia-shoot .sia-text, .sia-drain .sia-text { opacity: 0; transition: opacity 0.2s; }
@keyframes sia-in { from { opacity: 0; } }
@keyframes sia-out { to { opacity: 0; } }
`;

// Where each splash drop flies to (in pixels), and how big it is
const SPLASH = [
  { cx: 85, x: "-46px", y: "-38px", r: 6 },
  { cx: 115, x: "44px", y: "-44px", r: 6 },
  { cx: 75, x: "-70px", y: "-12px", r: 4.5 },
  { cx: 125, x: "68px", y: "-16px", r: 4.5 },
  { cx: 100, x: "-8px", y: "-60px", r: 4 },
];

export default function SignInAnimation({ status, onFinished, onCancelled }) {
  const [phase, setPhase] = useState("forming"); // "shoot" or "drain" next
  // When it started (set once it's on screen)
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    const timers = [];
    if (status === "done") {
      // Let the arrow finish forming before it takes off
      const wait = Math.max(0, FORM_TIME - (Date.now() - startedAt.current));
      timers.push(setTimeout(() => setPhase("shoot"), wait));
      timers.push(setTimeout(onFinished, wait + SHOOT_TIME));
    } else if (status === "failed") {
      timers.push(setTimeout(() => setPhase("drain"), 0));
      timers.push(setTimeout(onCancelled, 260));
    }
    return () => timers.forEach(clearTimeout);
    // Only when the sign-in result comes in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Drawn straight onto the page (a "portal"), so it covers everything,
  // whatever it's placed inside
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`sia fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-page ${
        phase === "shoot" ? "sia-shoot" : ""
      } ${phase === "drain" ? "sia-drain" : ""}`}
    >
      <style>{styles}</style>

      <svg
        viewBox="0 0 200 300"
        className="h-72 w-48 overflow-visible text-brand"
      >
        <defs>
          {/* Melts touching shapes together so they look like liquid */}
          <filter id="sia-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <linearGradient id="sia-streak" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.6" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The streak left behind on take-off (not liquid) */}
        <rect
          className="sia-trail"
          x="94"
          y="-40"
          width="12"
          height="280"
          rx="6"
          fill="url(#sia-streak)"
        />

        <g filter="url(#sia-goo)" fill="currentColor">
          <ellipse className="sia-puddle" cx="100" cy="258" rx="60" ry="12" />
          <circle className="sia-drop" cx="78" cy="252" r="6" />
          <circle className="sia-drop" cx="118" cy="252" r="5" />
          <circle className="sia-drop" cx="100" cy="250" r="5" />
          {SPLASH.map((s, i) => (
            <circle
              key={i}
              className="sia-splash"
              cx={s.cx}
              cy="252"
              r={s.r}
              style={{ "--x": s.x, "--y": s.y }}
            />
          ))}

          {/* The arrow: a stem and a head, rising out of the puddle */}
          <g className="sia-arrow">
            <rect
              className="sia-stem"
              x="91"
              y="104"
              width="18"
              height="152"
              rx="9"
            />
            <path
              className="sia-head"
              d="M60 140 100 100 140 140"
              fill="none"
              stroke="currentColor"
              strokeWidth="18"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </svg>

      <p className="sia-text mt-2 text-sm text-muted">Signing you in…</p>
    </div>,
    document.body,
  );
}
