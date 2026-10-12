import { useState } from "react";
import { Check, CircleCheck, Copy, TriangleAlert } from "lucide-react";
import { copyText } from "./copyText";
import { secondaryButton } from "./formStyles";

// Small pieces shared by the Phone and WhatsApp cards on the Integrations
// page (PhoneIntegration.jsx, WhatsAppIntegration.jsx)

export function Alert({ tone = "error", children }) {
  const styles = {
    error: "bg-red-50 text-red-600",
    warn: "bg-amber-50 text-amber-700",
    ok: "bg-brand/10 text-brand",
  };
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg p-3 text-sm ${styles[tone]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 wrap-break-word">{children}</div>
    </div>
  );
}

export function CopyRow({ value, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-page px-3 py-2.5 font-mono text-sm">
        {value}
      </code>
      <div className="flex">
        <button
          type="button"
          onClick={async () => {
            if (await copyText(value, `Copy the ${label}:`)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className={`${secondaryButton} flex items-center justify-center gap-2`}
        >
          {copied ? (
            <Check className="h-4 w-4 text-brand" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copied" : `Copy ${label}`}
        </button>
      </div>
    </div>
  );
}

// The on/off switch
export function Toggle({ on, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-brand" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// A setting with a switch: what it does on the left, the switch on the right
export function ToggleRow({ title, hint, on, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      <Toggle on={on} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function OnOffPill({ on }) {
  return on ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      On
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted">
      Off
    </span>
  );
}

// One numbered step in a "how to connect it" list
export function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page text-xs font-semibold">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        {children}
      </div>
    </li>
  );
}

// A section inside a card, with a small heading
export function Part({ title, hint, children }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
