import { useEffect } from "react";
import { Inbox, ShieldCheck, Clock } from "lucide-react";

const POINTS = [
  { icon: Inbox, text: "Every request in one place" },
  { icon: Clock, text: "Clear due times for every ticket" },
  { icon: ShieldCheck, text: "Customers only ever see their own tickets" },
];

// The frame for the sign-in and invite pages: a green welcome panel on the
// left (big screens only) and the form on the right
export default function AuthShell({ title, children }) {
  useEffect(() => {
    document.title = `${title} · Ticket Support`;
  }, [title]);

  return (
    <div className="grid min-h-dvh bg-page lg:grid-cols-2">
      {/* Welcome panel */}
      <div className="relative hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Soft circles in the background */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/10" />

        <div className="relative flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-white" />
          <span className="text-lg font-semibold">Ticket Support</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight">
            Help that keeps your business running.
          </h2>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
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
      <div className="flex flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="h-8 w-8 rounded-full bg-brand" />
          <span className="text-lg font-semibold">Ticket Support</span>
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
