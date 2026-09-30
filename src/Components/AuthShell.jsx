import { useEffect } from "react";
import { Inbox, ShieldCheck, Clock } from "lucide-react";
import { ThemeToggleButton } from "./ThemeToggle";

const POINTS = [
  { icon: Inbox, text: "Every request in one place" },
  { icon: Clock, text: "Clear due times for every ticket" },
  { icon: ShieldCheck, text: "Customers only ever see their own tickets" },
];

// The frame for the sign-in and invite pages: a green welcome panel on the
// left (big screens only) and the form on the right. Things come in with
// short animations (index.css).
export default function AuthShell({ title, children }) {
  useEffect(() => {
    document.title = `${title} · Ticket Support`;
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
      <div className="relative hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Soft circles in the background, drifting very slowly */}
        <div className="animate-drift pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="animate-drift-slow pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/10" />

        <div className="relative flex items-center gap-2">
          {/* bg-[#fff]: stays white in dark mode too */}
          <div className="h-8 w-8 rounded-full bg-white" />
          <span className="text-lg font-semibold">Ticket Support</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="animate-rise-in text-4xl font-semibold leading-tight">
            Help that keeps your business running.
          </h2>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map(({ icon: Icon, text }, i) => (
              <li
                key={text}
                className={`animate-rise-in wait-${i + 1} flex items-center gap-3`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-white/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/70">
          © {new Date().getFullYear()} Ticket Support
        </p>
      </div>

      {/* The form */}
      {/* Phones: starts near the top. Bigger screens: centred. */}
      <div className="flex min-w-0 flex-col items-center px-5 pb-10 pt-12 sm:justify-center sm:px-6 sm:py-10">
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="h-8 w-8 rounded-full bg-brand" />
          <span className="text-lg font-semibold">Ticket Support</span>
        </div>
        {/* The form rises into place */}
        <div className="animate-rise-in w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
