import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  Globe,
  Info,
  KeyRound,
  LoaderCircle,
  Lock,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Card from "./Card";
import Modal from "./Modal";
import { inputClass, primaryButton, secondaryButton } from "./formStyles";
import { copyText } from "./copyText";
import { api } from "../api";

// How often to look again while a domain is still being set up
const RECHECK_EVERY = 30 * 1000;

const STATUS = {
  secure: {
    label: "Secure",
    icon: Lock,
    badge: "bg-brand/10 text-brand",
  },
  issuing: {
    label: "Getting certificate",
    icon: LoaderCircle,
    badge: "bg-amber-100 text-amber-700",
    spin: true,
  },
  "waiting-dns": {
    label: "Waiting for DNS",
    icon: Globe,
    badge: "bg-line text-muted",
  },
};

function formatDate(time) {
  return new Date(time).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function StatusBadge({ status }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.badge}`}
    >
      <Icon className={`h-3.5 w-3.5 ${s.spin ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

// A small button that copies one value
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
      title={`Copy ${label}`}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.93]"
    >
      {copied ? (
        <Check className="h-4 w-4 text-brand" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

// The three steps, ticked off as they happen
function Steps({ domain }) {
  const steps = [
    { label: "Added to the site", done: true },
    { label: "DNS points here", done: domain.dnsVerified },
    { label: "SSL certificate", done: domain.certificate.secure },
  ];
  return (
    <ol className="grid grid-cols-3 gap-2">
      {steps.map((step, i) => (
        <li key={step.label} className="flex flex-col gap-1.5">
          <span
            className={`h-1.5 rounded-full ${step.done ? "bg-brand" : "bg-line"}`}
          />
          <span
            className={`flex items-center gap-1 text-xs ${
              step.done ? "font-medium text-brand" : "text-muted"
            }`}
          >
            {step.done ? (
              <CircleCheck className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px]">
                {i + 1}
              </span>
            )}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The DNS records to add, each with copy buttons
function DnsRecords({ domain }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        At the company you bought the domain from (GoDaddy, Namecheap,
        Cloudflare…), open its <strong>DNS</strong> settings and add:
      </p>
      {domain.records.map((r) => (
        <div
          key={`${r.type}-${r.host}`}
          className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-page p-3 text-sm"
        >
          <span className="text-xs text-muted">Type</span>
          <span className="font-mono font-medium">{r.type}</span>

          <span className="text-xs text-muted">Name / Host</span>
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-mono">{r.host}</span>
            <CopyButton value={r.host} label="name" />
          </span>

          <span className="text-xs text-muted">Value</span>
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-mono">{r.value}</span>
            <CopyButton value={r.value} label="value" />
          </span>
        </div>
      ))}
      <p className="text-xs text-muted">
        {domain.type === "root"
          ? "Remove any other A records and all AAAA records on @ first. "
          : `Some DNS pages want the full name instead (${domain.name}). `}
        DNS changes usually show up within minutes, but can take up to 24 hours.
        If you use Cloudflare, leave the cloud grey (DNS only) until the site
        shows Secure.
      </p>
      {domain.found.length > 0 && (
        <p className="text-xs text-muted">
          Right now it points to:{" "}
          <span className="font-mono">
            {domain.found.map((f) => `${f.type} ${f.value}`).join(", ")}
          </span>
        </p>
      )}
    </div>
  );
}

function DomainCard({ domain, onCheck, onRemove, checking }) {
  const secure = domain.certificate.secure;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 transition hover:border-brand/30 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 break-all text-base font-semibold">
            {secure && <Lock className="h-4 w-4 shrink-0 text-brand" />}
            {domain.name}
          </p>
          <p className="text-xs text-muted">
            {domain.redirectsTo
              ? `Sends visitors on to ${domain.redirectsTo}`
              : domain.type === "root"
                ? "Root domain"
                : "Subdomain"}
            {domain.addedAt && ` · added ${formatDate(domain.addedAt)}`}
          </p>
        </div>
        <StatusBadge status={domain.status} />
      </div>

      <Steps domain={domain} />

      {secure ? (
        <div className="flex items-start gap-3 rounded-lg bg-brand/10 p-3 text-sm text-brand">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Secured with a certificate from{" "}
            <strong>
              {domain.certificate.issuer ?? "a trusted authority"}
            </strong>
            {domain.certificate.expiresAt &&
              `, valid until ${formatDate(domain.certificate.expiresAt)}`}
            . It renews by itself before then.
          </p>
        </div>
      ) : (
        <>
          {domain.hasIpv6 && (
            <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This domain has an <strong>AAAA</strong> record. Delete it in
                your DNS settings, or the certificate can't be made.
              </p>
            </div>
          )}
          {domain.dnsVerified ? (
            <p className="flex items-start gap-2 text-sm text-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              The DNS is right. The certificate is being made now, which usually
              takes a few minutes. This page checks again by itself.
            </p>
          ) : (
            <DnsRecords domain={domain} />
          )}
          {domain.certificate.problem && (
            <p className="text-xs text-muted">
              Last check: {domain.certificate.problem}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {secure ? (
          <a
            href={`https://${domain.name}`}
            target="_blank"
            rel="noreferrer"
            className={`${secondaryButton} flex items-center justify-center gap-2`}
          >
            <ExternalLink className="h-4 w-4" />
            Open site
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onCheck(domain.name)}
            disabled={checking}
            className={`${secondaryButton} flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60`}
          >
            <RefreshCw
              className={`h-4 w-4 ${checking ? "animate-spin" : ""}`}
            />
            {checking ? "Checking…" : "Check now"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onRemove(domain)}
          className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm text-red-500 transition hover:border-red-300 hover:bg-red-50 active:scale-[0.97] sm:flex-none"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>
    </div>
  );
}

// Shown until RENDER_API_KEY and RENDER_SERVICE_ID are on the server
function ConnectRender({ missing, onRender }) {
  const steps = [
    {
      title: "Make a Render API key",
      text: "In Render, open Account Settings → API Keys → Create API Key, and copy it.",
      show: missing.includes("RENDER_API_KEY"),
    },
    {
      title: "Give it to the server",
      text: "Open your web service in Render → Environment → Add Environment Variable. Key: RENDER_API_KEY, Value: the key you copied. Save, and Render restarts the site.",
      show: missing.includes("RENDER_API_KEY"),
    },
    {
      title: "Service ID",
      text: onRender
        ? "Render normally sets RENDER_SERVICE_ID by itself. Add it the same way: it's the srv-... part of the service's address in the Render dashboard."
        : "You're running this locally. To try it here, add RENDER_SERVICE_ID (the srv-... part of the service's address in the Render dashboard) to server/.env too. On the live site Render sets it by itself.",
      show: missing.includes("RENDER_SERVICE_ID"),
    },
  ].filter((s) => s.show);

  return (
    <Card title="Connect to Render">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">
          The site runs on Render, and Render is what puts the SSL certificate
          on your domain. Connect it once, and adding a domain here does the
          rest.
        </p>
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <span>
                <span className="font-medium">{step.title}</span>
                <span className="block text-muted">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-3 text-amber-700">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The API key can change anything on your Render account. It stays on
            the server only and is never shown in the app. Never put it in
            GitHub.
          </p>
        </div>
      </div>
    </Card>
  );
}

function ConfirmRemove({ domain, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleRemove(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Remove this domain?"
      onClose={busy ? () => {} : onClose}
      onSubmit={handleRemove}
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
            disabled={busy}
            className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60 sm:flex-none"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy ? "Removing…" : "Remove"}
          </button>
        </>
      }
    >
      <p className="text-sm">
        <strong className="break-all">{domain.name}</strong> stops opening the
        helpdesk, and its certificate stops being renewed. The site keeps
        working on its other addresses. You can add it back any time.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
}

// Settings → Domain & SSL: type in a domain, point its DNS here, and it
// gets a free SSL certificate that renews by itself (server/src/domains.js)
export default function DomainSettings() {
  const [info, setInfo] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [checking, setChecking] = useState(null); // the domain being checked
  const [removing, setRemoving] = useState(null); // the domain to confirm

  const load = useCallback(async () => {
    try {
      setInfo(await api("/domains"));
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  // The first load, when the tab opens
  useEffect(() => {
    api("/domains")
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  }, []);

  // While any domain isn't secure yet, look again every 30 seconds
  const settingUp = info?.domains.some((d) => d.status !== "secure");
  useEffect(() => {
    if (!settingUp) return;
    const timer = setInterval(load, RECHECK_EVERY);
    return () => clearInterval(timer);
  }, [settingUp, load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setAdding(true);
    setAddError("");
    try {
      setInfo(await api("/domains", { method: "POST", body: { name } }));
      setName("");
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleCheck(domainName) {
    setChecking(domainName);
    try {
      setInfo(
        await api(`/domains/${encodeURIComponent(domainName)}/check`, {
          method: "POST",
        }),
      );
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setChecking(null);
    }
  }

  async function handleRemove() {
    const result = await api(`/domains/${encodeURIComponent(removing.name)}`, {
      method: "DELETE",
    });
    setInfo(result);
    setRemoving(null);
  }

  if (!info) {
    return (
      <Card title="Domain & SSL">
        {loadError ? (
          <p className="flex items-start gap-2 text-sm text-red-500">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {loadError}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {!info.connected ? (
        <ConnectRender missing={info.missing} onRender={info.onRender} />
      ) : (
        <Card title="Use your own domain">
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Type the address the helpdesk should open on. It gets a free SSL
              certificate (https and the padlock) from Let's Encrypt as soon as
              its DNS points here, and it renews by itself.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setAddError("");
                }}
                placeholder="helpdesk.yourcompany.com"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                aria-label="Domain name"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={adding || !name.trim()}
                className={`${primaryButton} flex shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {adding ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                {adding ? "Adding…" : "Secure domain"}
              </button>
            </div>
            {addError && (
              <p
                role="alert"
                className="flex items-start gap-2 text-sm text-red-500"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {addError}
              </p>
            )}
            <p className="text-xs text-muted">
              A root domain (yourcompany.com) gets www.yourcompany.com added
              too, which sends visitors to the main one.
            </p>
          </form>
        </Card>
      )}

      {loadError && (
        <p className="flex items-start gap-2 text-sm text-red-500">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </p>
      )}

      {info.domains.length > 0 && (
        <div className="flex flex-col gap-3">
          {info.domains.map((domain) => (
            <DomainCard
              key={domain.name}
              domain={domain}
              checking={checking === domain.name}
              onCheck={handleCheck}
              onRemove={setRemoving}
            />
          ))}
        </div>
      )}

      {info.connected && info.target && (
        <p className="text-xs text-muted">
          The site also always works on{" "}
          <span className="font-mono">https://{info.target}</span>.
        </p>
      )}

      {removing && (
        <ConfirmRemove
          domain={removing}
          onConfirm={handleRemove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
