import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  MessageCircle,
  PhoneCall,
} from "lucide-react";
import { copyText } from "../copyText";
import EmailIntegration from "../EmailIntegration";
import { inputClass, labelClass, secondaryButton } from "../formStyles";

// Integrations: every way customers can reach the helpdesk, in one
// place. Each one turns what comes in (a form, an email, a WhatsApp
// message, a phone call) into tickets in the same Inbox.
//
// The website form and email work today (email: EmailIntegration.jsx).
// The others are shown with what they'll do, so the page already
// explains where the helpdesk is going.

// Coming next, in the order they'll be built
const COMING = [
  {
    id: "phone",
    name: "Phone (PBX)",
    icon: PhoneCall,
    tint: "bg-violet-500/15 text-violet-500",
    blurb:
      "When an agent can't pick up, the call goes to your phone system (3CX, FreePBX...) and the caller leaves a voicemail, which becomes a ticket for that agent.",
    points: [
      "The recording attached to the ticket",
      "A written transcript, made on your own server",
      "The caller matched to the customer by phone number",
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: MessageCircle,
    tint: "bg-emerald-500/15 text-emerald-500",
    blurb:
      "Messages and voice notes sent to each agent's WhatsApp Business number become tickets for that agent. Free: the helpdesk only reads, it never sends.",
    points: [
      "Each agent's company number, connected once",
      "Voice notes attached, with a written transcript",
      "Uses the official WhatsApp Business Platform",
    ],
  },
];

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  return (
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
  );
}

function StatusPill({ live }) {
  return live ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      On
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted">
      Coming soon
    </span>
  );
}

// The public request form (/request): its link, and the code to put it
// on another website, with its colours picked here
function WebsiteForm() {
  const origin = window.location.origin;
  const [dark, setDark] = useState(false);
  const [accent, setAccent] = useState("");

  const extras = [
    dark ? "theme=dark" : "",
    /^#?[0-9a-f]{6}$/i.test(accent) ? `accent=${accent.replace("#", "")}` : "",
  ].filter(Boolean);
  const src = `${origin}/request?embed=1${extras.length ? `&${extras.join("&")}` : ""}`;
  const link = `${origin}/request`;

  // The iframe, plus a few lines that let it grow and shrink with the
  // form (the form tells the page its height, see RequestForm.jsx)
  const embed = `<iframe id="deskflow-form" src="${src}" title="Contact support" style="width:100%;border:0;min-height:600px"></iframe>
<script>
  window.addEventListener("message", function (e) {
    if (e.origin !== "${origin}" || !e.data || e.data.type !== "deskflow-height") return;
    document.getElementById("deskflow-form").style.height = e.data.height + "px";
  });
</script>`;

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Globe className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Website form</h2>
            <p className="text-sm text-muted">
              Anyone can send a request without an account. Each one becomes a
              ticket, and the customer is added or matched by email.
            </p>
          </div>
        </div>
        <StatusPill live />
      </div>

      {/* The link */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Share the link</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-page px-3 py-2.5 font-mono text-sm">
            {link}
          </code>
          <div className="flex gap-2">
            <CopyButton value={link} label="link" />
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className={`${secondaryButton} flex items-center justify-center gap-2`}
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </div>
        </div>
      </div>

      {/* Putting it on another website */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium">Put it on your website</p>
          <p className="text-sm text-muted">
            Paste this where the form should appear, e.g. a Custom HTML block in
            WordPress. It fits its height to the form by itself.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span>Button colour</span>
            <div className="flex gap-2">
              <input
                type="color"
                value={
                  /^#?[0-9a-f]{6}$/i.test(accent)
                    ? `#${accent.replace("#", "")}`
                    : "#00b67a"
                }
                onChange={(e) => setAccent(e.target.value)}
                aria-label="Pick a colour"
                className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1"
              />
              <input
                value={accent}
                onChange={(e) => setAccent(e.target.value.trim())}
                placeholder="Helpdesk green"
                autoCapitalize="none"
                spellCheck="false"
                className={inputClass}
              />
            </div>
          </label>
          <div className={labelClass}>
            <span>Colours</span>
            <div className="flex h-11 rounded-lg border border-line bg-white p-1 text-sm">
              {[
                { label: "Light", value: false },
                { label: "Dark", value: true },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setDark(t.value)}
                  className={`flex-1 cursor-pointer rounded-md transition active:scale-[0.97] ${
                    dark === t.value
                      ? "bg-brand/10 font-medium text-brand"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-page p-3 font-mono text-xs leading-relaxed">
          {embed}
        </pre>
        <div className="flex">
          <CopyButton value={embed} label="code" />
        </div>
      </div>
    </section>
  );
}

function ComingCard({ item }) {
  const Icon = item.icon;
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tint}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <StatusPill live={false} />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{item.name}</h2>
        <p className="mt-1 text-sm text-muted">{item.blurb}</p>
      </div>
      <ul className="mt-auto flex flex-col gap-2 text-sm">
        {item.points.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Integrations() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Every way customers can reach you, landing in one Inbox.
        </p>
      </div>

      <WebsiteForm />
      <EmailIntegration />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Coming next
        </h2>
      </div>
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {COMING.map((item) => (
          <ComingCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
