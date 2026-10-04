import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  LoaderCircle,
  Mail,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Modal from "./Modal";
import { copyText } from "./copyText";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { api } from "../api";

// Integrations → Email: connect mailboxes, so customers' emails become
// tickets and replies go back by email (server/src/email.js).
// Everything is set up from here, nothing in server/.env:
//   - mailboxes: Sign in with Microsoft / Google, or Other (address +
//     password), each with who its new tickets go to
//   - the Microsoft and Google sign-in apps: their Client ID and secret

const PROVIDER_LABEL = {
  microsoft: "Microsoft",
  google: "Google",
  imap: "Other",
};

// Server settings for common providers, filled in from the address
const PRESETS = {
  "gmail.com": {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    note: "Use an app password: Google Account → Security → 2-Step Verification → App passwords.",
  },
  "googlemail.com": {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    note: "Use an app password: Google Account → Security → 2-Step Verification → App passwords.",
  },
  "yahoo.com": {
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    note: "Use an app password from Yahoo's account security page.",
  },
  "icloud.com": {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    note: "Use an app-specific password from appleid.apple.com.",
  },
  "me.com": {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    note: "Use an app-specific password from appleid.apple.com.",
  },
  "zoho.com": {
    imapHost: "imap.zoho.com",
    imapPort: 993,
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
  },
};
const MICROSOFT_DOMAINS = ["outlook.com", "hotmail.com", "live.com", "msn.com"];

function presetFor(address) {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  if (PRESETS[domain]) return PRESETS[domain];
  if (MICROSOFT_DOMAINS.includes(domain)) return { microsoft: true };
  if (!domain.includes(".")) return null;
  // Most hosting companies use mail.<domain>
  return {
    imapHost: `mail.${domain}`,
    imapPort: 993,
    smtpHost: `mail.${domain}`,
    smtpPort: 465,
    guessed: true,
  };
}

function timeAgo(time) {
  if (!time) return "not checked yet";
  const mins = Math.round((Date.now() - time) / 60000);
  if (mins < 1) return "checked just now";
  if (mins < 60) return `checked ${mins} min ago`;
  return `checked ${new Date(time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
}

function CopyLine({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-page p-2 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <button
        type="button"
        onClick={async () => {
          if (await copyText(value, "Copy this:")) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
        title="Copy"
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-brand/10 hover:text-brand"
      >
        {copied ? (
          <Check className="h-4 w-4 text-brand" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function Alert({ tone = "error", children }) {
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

// ---------- One connected mailbox ----------

function MailboxCard({ box, agents, teams, onChange, onSignIn }) {
  const [busy, setBusy] = useState(""); // which button is working
  const [message, setMessage] = useState(null); // { tone, text }
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [newPassword, setNewPassword] = useState(null); // null = closed

  async function run(what, action) {
    setBusy(what);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ tone: "error", text: err.message });
    }
    setBusy("");
  }

  const save = (changes) =>
    run("save", async () =>
      onChange(
        await api(`/email/mailboxes/${box.id}`, {
          method: "PATCH",
          body: changes,
        }),
      ),
    );

  const selectClass = `${inputClass} cursor-pointer`;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-semibold">{box.address}</p>
          <p className="text-xs text-muted">
            {PROVIDER_LABEL[box.provider]} ·{" "}
            {box.enabled ? timeAgo(box.lastCheckedAt) : "switched off"}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={box.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-brand"
          />
          On
        </label>
      </div>

      {box.lastError && (
        <Alert>
          <p>{box.lastError}</p>
          {box.provider === "imap" ? (
            <button
              type="button"
              onClick={() => setNewPassword("")}
              className="mt-1 cursor-pointer font-medium underline"
            >
              Enter the password again
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSignIn(box.provider)}
              className="mt-1 cursor-pointer font-medium underline"
            >
              Sign in again
            </button>
          )}
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          <span>New tickets go to</span>
          <select
            value={box.assigneeId ?? ""}
            onChange={(e) => save({ assigneeId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">Nobody (assignment rules)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Team</span>
          <select
            value={box.departmentId ?? ""}
            onChange={(e) => save({ departmentId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Name on automatic replies</span>
          <input
            defaultValue={box.name}
            placeholder="e.g. Uplink Support"
            onBlur={(e) =>
              e.target.value !== box.name && save({ name: e.target.value })
            }
            className={inputClass}
          />
        </label>
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() =>
            run("check", async () => {
              onChange(
                await api(`/email/mailboxes/${box.id}/check`, {
                  method: "POST",
                }),
              );
              setMessage({
                tone: "ok",
                text: "Checked. Any new emails are now tickets.",
              });
            })
          }
          className={`${secondaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
        >
          <RefreshCw
            className={`h-4 w-4 ${busy === "check" ? "animate-spin" : ""}`}
          />
          Check now
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() =>
            run("test", async () => {
              const r = await api(`/email/mailboxes/${box.id}/test`, {
                method: "POST",
              });
              setMessage({ tone: "ok", text: `Test email sent to ${r.to}.` });
            })
          }
          className={`${secondaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
        >
          {busy === "test" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send test email
        </button>
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm text-red-500 transition hover:border-red-300 hover:bg-red-50 active:scale-[0.97] sm:flex-none"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>

      {confirmRemove && (
        <Modal
          title="Remove this mailbox?"
          onClose={() => setConfirmRemove(false)}
          onSubmit={async (e) => {
            e.preventDefault();
            await run("remove", async () =>
              onChange(
                await api(`/email/mailboxes/${box.id}`, { method: "DELETE" }),
              ),
            );
            setConfirmRemove(false);
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 sm:flex-none"
              >
                Remove
              </button>
            </>
          }
        >
          <p className="text-sm">
            New emails to <strong className="break-all">{box.address}</strong>{" "}
            stop becoming tickets, and replies on its tickets stop being
            emailed. Tickets already made stay. Nothing in the mailbox itself is
            changed.
          </p>
        </Modal>
      )}

      {newPassword !== null && (
        <Modal
          title="Enter the password again"
          onClose={() => setNewPassword(null)}
          onSubmit={async (e) => {
            e.preventDefault();
            await run("password", async () => {
              onChange(
                await api(`/email/mailboxes/${box.id}`, {
                  method: "PATCH",
                  body: { password: newPassword },
                }),
              );
              setNewPassword(null);
            });
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setNewPassword(null)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newPassword || busy === "password"}
                className={`${primaryButton} disabled:opacity-60`}
              >
                {busy === "password" ? "Checking…" : "Save"}
              </button>
            </>
          }
        >
          <label className={labelClass}>
            <span>Password (or app password) for {box.address}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
          {message && <Alert>{message.text}</Alert>}
        </Modal>
      )}
    </div>
  );
}

// ---------- Adding an "Other" mailbox ----------

function OtherMailbox({ onClose, onAdded }) {
  const [form, setForm] = useState({
    address: "",
    password: "",
    name: "",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
  });
  const [preset, setPreset] = useState(null);
  const [showServers, setShowServers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (changes) => {
    setForm((f) => ({ ...f, ...changes }));
    setError("");
  };

  function onAddress(address) {
    const p = presetFor(address);
    setPreset(p);
    set({
      address,
      ...(p && !p.microsoft
        ? {
            imapHost: p.imapHost,
            imapPort: p.imapPort,
            smtpHost: p.smtpHost,
            smtpPort: p.smtpPort,
          }
        : {}),
    });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAdded(await api("/email/mailboxes", { method: "POST", body: form }));
      onClose();
    } catch (err) {
      setError(err.message);
      if (/server|port/i.test(err.message)) setShowServers(true);
    }
    setBusy(false);
  }

  return (
    <Modal
      title="Connect a mailbox"
      onClose={busy ? () => {} : onClose}
      onSubmit={submit}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              busy || !form.address || !form.password || preset?.microsoft
            }
            className={`${primaryButton} flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy ? "Connecting…" : "Connect"}
          </button>
        </>
      }
    >
      <label className={labelClass}>
        <span>Email address</span>
        <input
          type="email"
          value={form.address}
          onChange={(e) => onAddress(e.target.value.trim())}
          placeholder="support@yourcompany.com"
          autoCapitalize="none"
          autoComplete="off"
          className={inputClass}
        />
      </label>
      {preset?.microsoft ? (
        <Alert tone="warn">
          Microsoft mailboxes can't connect with a password anymore. Use
          <strong> Sign in with Microsoft</strong> instead.
        </Alert>
      ) : (
        <>
          <label className={labelClass}>
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
          {preset?.note && <Alert tone="warn">{preset.note}</Alert>}
          <label className={labelClass}>
            <span>
              Name on automatic replies{" "}
              <span className="font-normal text-muted">(optional)</span>
            </span>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. the agent's name, or Uplink Support"
              className={inputClass}
            />
          </label>

          <button
            type="button"
            onClick={() => setShowServers((v) => !v)}
            className="flex cursor-pointer items-center gap-1 self-start text-sm text-muted hover:text-ink"
          >
            <ChevronDown
              className={`h-4 w-4 transition ${showServers ? "rotate-180" : ""}`}
            />
            Server settings{" "}
            {preset?.guessed && "(guessed, check with your email host)"}
          </button>
          {showServers && (
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <label className={labelClass}>
                <span>Incoming (IMAP) server</span>
                <input
                  value={form.imapHost}
                  onChange={(e) => set({ imapHost: e.target.value.trim() })}
                  placeholder="imap.example.com"
                  autoCapitalize="none"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                <span>Port</span>
                <input
                  type="number"
                  value={form.imapPort}
                  onChange={(e) => set({ imapPort: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                <span>Outgoing (SMTP) server</span>
                <input
                  value={form.smtpHost}
                  onChange={(e) => set({ smtpHost: e.target.value.trim() })}
                  placeholder="smtp.example.com"
                  autoCapitalize="none"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                <span>Port</span>
                <input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => set({ smtpPort: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            </div>
          )}
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

// ---------- The Microsoft and Google sign-in apps ----------

const APP_GUIDES = {
  microsoft: {
    title: "Microsoft sign-in",
    steps: [
      "Go to entra.microsoft.com → Applications → App registrations → New registration.",
      'Name it (e.g. "Helpdesk"). Supported account types: "Accounts in any organizational directory and personal Microsoft accounts" (or only your organization).',
      "Redirect URI: choose Web, and paste the address below.",
      "After it's made: copy the Application (client) ID into Client ID here.",
      "Certificates & secrets → New client secret → copy its Value into Client secret here.",
      "API permissions → Add → APIs my organization uses → Office 365 Exchange Online → Delegated: IMAP.AccessAsUser.All and SMTP.Send. Then Grant admin consent if you're the admin.",
    ],
  },
  google: {
    title: "Google sign-in",
    steps: [
      'Go to console.cloud.google.com and create a project (e.g. "Helpdesk").',
      "APIs & Services → Library → turn on the Gmail API.",
      "OAuth consent screen: Internal if it's only for your Google Workspace, otherwise External (then add the mailboxes you'll connect as test users).",
      "Credentials → Create credentials → OAuth client ID → Web application.",
      "Authorized redirect URIs: paste the address below.",
      "Copy the Client ID and Client secret into the fields here.",
    ],
  },
};

function AppSetup({ provider, app, redirectUri, onSaved }) {
  const guide = APP_GUIDES[provider];
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(app.clientId);
  const [secret, setSecret] = useState("");
  const [tenant, setTenant] = useState(app.tenant ?? "common");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function save(e, clear = false) {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body = clear
        ? { clientId: "" }
        : { clientId, clientSecret: secret, tenant };
      onSaved(await api(`/email/apps/${provider}`, { method: "PUT", body }));
      setSecret("");
      if (clear) setClientId("");
      setMessage({
        tone: "ok",
        text: clear ? "Removed." : "Saved. The sign-in button is ready.",
      });
    } catch (err) {
      setMessage({ tone: "error", text: err.message });
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 p-4 text-left"
      >
        <span className="font-medium">{guide.title}</span>
        <span className="flex items-center gap-2 text-xs">
          {app.ready ? (
            <span className="rounded-full bg-brand/10 px-2.5 py-1 font-medium text-brand">
              Set up
            </span>
          ) : (
            <span className="rounded-full bg-line px-2.5 py-1 font-medium text-muted">
              Not set up
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-muted transition ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <form
          onSubmit={save}
          className="flex flex-col gap-4 border-t border-line p-4"
        >
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Redirect URI</span>
            <CopyLine value={redirectUri} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span>Client ID</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value.trim())}
                autoComplete="off"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              <span>Client secret</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  app.ready ? "Saved. Paste a new one to change it" : ""
                }
                autoComplete="new-password"
                className={inputClass}
              />
            </label>
            {provider === "microsoft" && (
              <label className={labelClass}>
                <span>
                  Tenant{" "}
                  <span className="font-normal text-muted">
                    (common = any account)
                  </span>
                </span>
                <input
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value.trim())}
                  className={inputClass}
                />
              </label>
            )}
          </div>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || !clientId}
              className={`${primaryButton} disabled:opacity-60`}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {app.ready && (
              <button
                type="button"
                onClick={(e) => save(e, true)}
                disabled={busy}
                className={secondaryButton}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- The whole section ----------

export default function EmailIntegration() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState("");
  const [signInError, setSignInError] = useState("");
  const [params, setParams] = useSearchParams();
  const redirectUri = `${window.location.origin}/api/email/oauth/callback`;

  // Back from signing in with Microsoft/Google: the result is in the
  // address (?emailConnected= or ?emailError=)
  const connected = params.get("emailConnected");
  const returnedError = params.get("emailError");

  useEffect(() => {
    api("/email")
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  }, []);

  async function signIn(provider) {
    setStarting(provider);
    setSignInError("");
    try {
      const { url } = await api("/email/oauth/start", {
        method: "POST",
        body: { provider, origin: window.location.origin },
      });
      window.location.assign(url);
    } catch (err) {
      setSignInError(err.message);
      setStarting("");
    }
  }

  const live = info?.mailboxes.some((b) => b.enabled && !b.lastError);

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Email</h2>
            <p className="text-sm text-muted">
              Emails to these mailboxes become tickets, and replies on those
              tickets go back to the customer by email, in the same thread.
            </p>
          </div>
        </div>
        {live ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            On
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted">
            Not set up
          </span>
        )}
      </div>

      {(connected || returnedError) && (
        <div className="flex flex-col gap-2">
          <Alert tone={connected ? "ok" : "error"}>
            {connected
              ? `${connected} is connected. New emails to it will become tickets.`
              : returnedError}
          </Alert>
          <button
            type="button"
            onClick={() => {
              params.delete("emailConnected");
              params.delete("emailError");
              setParams(params, { replace: true });
            }}
            className="cursor-pointer self-start text-xs text-muted underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loadError && <Alert>{loadError}</Alert>}
      {!info && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      )}

      {info && (
        <>
          {info.mailboxes.length > 0 && (
            <div className="flex flex-col gap-3">
              {info.mailboxes.map((box) => (
                <MailboxCard
                  key={box.id}
                  box={box}
                  agents={info.agents}
                  teams={info.teams}
                  onChange={setInfo}
                  onSignIn={signIn}
                />
              ))}
            </div>
          )}

          {/* Add a mailbox */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {info.mailboxes.length
                ? "Add another mailbox"
                : "Connect a mailbox"}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {["microsoft", "google"].map((provider) => (
                <button
                  key={provider}
                  type="button"
                  disabled={!info.apps[provider].ready || Boolean(starting)}
                  onClick={() => signIn(provider)}
                  title={
                    info.apps[provider].ready
                      ? ""
                      : `Set up the ${PROVIDER_LABEL[provider]} sign-in below first`
                  }
                  className={`${secondaryButton} flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {starting === provider && (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  )}
                  Sign in with {PROVIDER_LABEL[provider]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAdding(true)}
                className={`${secondaryButton} flex w-full items-center justify-center gap-2`}
              >
                Other mailbox
              </button>
            </div>
            {signInError && <Alert>{signInError}</Alert>}
            {(!info.apps.microsoft.ready || !info.apps.google.ready) && (
              <p className="text-xs text-muted">
                The Microsoft and Google buttons work once their sign-in is set
                up below (once per helpdesk, with your company's Microsoft or
                Google account).
              </p>
            )}
          </div>

          {/* The sign-in apps */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Sign-in setup</p>
            <AppSetup
              provider="microsoft"
              app={info.apps.microsoft}
              redirectUri={redirectUri}
              onSaved={setInfo}
            />
            <AppSetup
              provider="google"
              app={info.apps.google}
              redirectUri={redirectUri}
              onSaved={setInfo}
            />
          </div>
        </>
      )}

      {adding && (
        <OtherMailbox onClose={() => setAdding(false)} onAdded={setInfo} />
      )}
    </section>
  );
}
