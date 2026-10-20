import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Mail, MessageCircle, Plus, RefreshCw, Send, Smartphone, Trash2 } from "lucide-react";
import Droplets from "./Droplets";
import { OtherMailbox } from "./EmailIntegration";
import { primaryButton, secondaryButton } from "./formStyles";
import { Alert, OnOffPill, Toggle } from "./integrationParts";
import { embeddedSignup, loadFacebook } from "./whatsappSignup";
import { api } from "../api";
import { timeAgo } from "../data";

// Integrations, for agents: their own email and WhatsApp only. Mailboxes
// they connect are theirs (new tickets from them go to them), and so is
// the WhatsApp number they connect. Everything else on the Integrations
// page (other people's, teams, filters, the website form, the phone
// system) is for Admins (Pages/Integrations.jsx).
// Server: /api/email/mine (email.js) and /api/whatsapp/mine (whatsapp.js).

const PROVIDER = { microsoft: "Microsoft", google: "Google", imap: "Email" };

function Card({ icon: Icon, tint, title, hint, on, children }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tint}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted">{hint}</p>
          </div>
        </div>
        <OnOffPill on={on} />
      </div>
      {children}
    </section>
  );
}

// ---------- My email ----------

function MyEmail() {
  const [params, setParams] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api("/email/mine")
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

  // Back from signing in with Microsoft/Google (?emailConnected= or ?emailError=)
  const connected = params.get("emailConnected");
  const returnedError = params.get("emailError");
  const clearReturn = () => {
    const next = new URLSearchParams(params);
    next.delete("emailConnected");
    next.delete("emailError");
    setParams(next, { replace: true });
  };

  async function run(what, request, message = "") {
    setBusy(what);
    setError("");
    setNotice("");
    try {
      const result = await request();
      if (result?.mailboxes) setInfo(result);
      if (message) setNotice(typeof message === "function" ? message(result) : message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function signIn(provider) {
    setBusy(provider);
    setError("");
    try {
      const { url } = await api("/email/mine/oauth/start", {
        method: "POST",
        body: { provider, origin: window.location.origin },
      });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  const boxes = info?.mailboxes ?? [];
  return (
    <Card
      icon={Mail}
      tint="bg-sky-500/15 text-sky-500"
      title="My email"
      hint="Connect your work mailbox: emails to it become tickets for you, and your replies go out from it."
      on={boxes.some((b) => b.enabled && !b.lastError)}
    >
      {connected && (
        <Alert tone="ok">
          {connected} is connected.{" "}
          <button type="button" onClick={clearReturn} className="cursor-pointer underline">OK</button>
        </Alert>
      )}
      {returnedError && (
        <Alert>
          {returnedError}{" "}
          <button type="button" onClick={clearReturn} className="cursor-pointer underline">OK</button>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}

      {!info ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" /> Loading…
        </p>
      ) : (
        <>
          {boxes.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {boxes.map((b) => (
                <li key={b.id} className="flex flex-col gap-3 p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.address}</p>
                      <p className={`text-xs ${b.lastError ? "text-red-600" : "text-muted"}`}>
                        {PROVIDER[b.provider] ?? b.provider}
                        {b.lastError
                          ? `: ${b.lastError}`
                          : b.lastCheckedAt
                            ? `, checked ${timeAgo(b.lastCheckedAt)}`
                            : ", not checked yet"}
                      </p>
                    </div>
                    <Toggle
                      on={b.enabled}
                      label={`Read ${b.address}`}
                      disabled={busy === `on-${b.id}`}
                      onChange={(on) =>
                        run(`on-${b.id}`, () => api(`/email/mine/mailboxes/${b.id}`, { method: "PATCH", body: { enabled: on } }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy === `check-${b.id}`}
                      onClick={() => run(`check-${b.id}`, () => api(`/email/mine/mailboxes/${b.id}/check`, { method: "POST" }), "Checked for new emails.")}
                      className={`${secondaryButton} flex items-center justify-center gap-2`}
                    >
                      {busy === `check-${b.id}` ? <Droplets className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                      Check now
                    </button>
                    <button
                      type="button"
                      disabled={busy === `test-${b.id}`}
                      onClick={() =>
                        run(`test-${b.id}`, () => api(`/email/mine/mailboxes/${b.id}/test`, { method: "POST" }), (r) => `A test email was sent to ${r.to}.`)
                      }
                      className={`${secondaryButton} flex items-center justify-center gap-2`}
                    >
                      {busy === `test-${b.id}` ? <Droplets className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                      Send a test
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Disconnect ${b.address}? Its emails stop becoming tickets. Tickets it already made stay.`))
                          run(`remove-${b.id}`, () => api(`/email/mine/mailboxes/${b.id}`, { method: "DELETE" }));
                      }}
                      className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" /> Disconnect
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {info.signIns.microsoft && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => signIn("microsoft")}
                className={`${primaryButton} flex basis-auto items-center justify-center gap-2 disabled:opacity-60`}
              >
                {busy === "microsoft" && <Droplets className="h-4 w-4" />}
                Sign in with Microsoft
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`${secondaryButton} flex basis-auto items-center justify-center gap-2`}
            >
              <Plus className="h-4 w-4" /> Sign in with email
            </button>
          </div>
          {!info.signIns.microsoft && (
            <p className="text-xs text-muted">
              For a Microsoft 365 mailbox, ask an Admin to set up the Microsoft sign-in (Integrations → Email).
            </p>
          )}
        </>
      )}

      {adding && (
        <OtherMailbox
          endpoint="/email/mine/mailboxes"
          onClose={() => setAdding(false)}
          onAdded={(result) => {
            setInfo(result);
            setNotice("Connected. New emails to it become tickets for you.");
          }}
        />
      )}
    </Card>
  );
}

// ---------- My WhatsApp ----------

function MyWhatsApp() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [fb, setFb] = useState(null);

  useEffect(() => {
    api("/whatsapp/mine")
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

  const ready = Boolean(info?.ready);
  const appId = info?.appId;
  const graphVersion = info?.graphVersion;
  // Facebook's script is loaded once it's set up, so Meta's window can open
  // straight from the click
  useEffect(() => {
    if (!ready) return;
    loadFacebook(appId, graphVersion)
      .then(setFb)
      .catch((err) => setError(err.message));
  }, [ready, appId, graphVersion]);

  function connect() {
    if (!fb) return;
    setBusy("connect");
    setError("");
    embeddedSignup(fb, info.configId)
      .then((session) => api("/whatsapp/mine/signup", { method: "POST", body: session }))
      .then(setInfo)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(""));
  }

  async function change(what, request) {
    setBusy(what);
    setError("");
    try {
      setInfo(await request());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const numbers = info?.numbers ?? [];
  return (
    <Card
      icon={MessageCircle}
      tint="bg-emerald-500/15 text-emerald-500"
      title="My WhatsApp"
      hint="Connect your WhatsApp Business number: messages to it become tickets for you. You keep using the WhatsApp Business app on your phone as normal."
      on={numbers.some((n) => n.enabled)}
    >
      {error && <Alert>{error}</Alert>}
      {!info ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" /> Loading…
        </p>
      ) : (
        <>
          {numbers.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {numbers.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 p-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {n.displayNumber}
                      {n.name && <span className="font-normal text-muted"> {n.name}</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {n.lastMessageAt ? `Last message ${timeAgo(n.lastMessageAt)}` : "No messages yet"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Stop reading ${n.displayNumber}? Your WhatsApp keeps working as normal; its messages just stop becoming tickets.`))
                          change(`remove-${n.id}`, () => api(`/whatsapp/mine/numbers/${n.id}`, { method: "DELETE" }));
                      }}
                      className="mt-1 flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  </div>
                  <Toggle
                    on={n.enabled}
                    label={`Read ${n.displayNumber}`}
                    disabled={busy === `on-${n.id}`}
                    onChange={(on) =>
                      change(`on-${n.id}`, () => api(`/whatsapp/mine/numbers/${n.id}`, { method: "PATCH", body: { enabled: on } }))
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {ready ? (
            <div className="flex flex-col gap-3 rounded-lg bg-page p-3 text-sm sm:p-4">
              <p>
                Have your phone ready, with the WhatsApp Business app up to date. Meta's window opens: sign in with
                Facebook, pick the business, enter your number, then scan the code it shows with the WhatsApp Business app.
              </p>
              <div className="flex">
                <button
                  type="button"
                  disabled={!fb || busy === "connect"}
                  onClick={connect}
                  className={`${primaryButton} flex basis-auto items-center justify-center gap-2 disabled:opacity-60`}
                >
                  {busy === "connect" || !fb ? <Droplets className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  Connect my number
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              An Admin has to set up WhatsApp for the helpdesk first (Integrations → WhatsApp). Then you can connect your number here.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

export default function MyIntegrations() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Your own email and WhatsApp. Tickets from them come to you. The rest of the Integrations is set up by Admins.
        </p>
      </div>
      <MyEmail />
      <MyWhatsApp />
    </div>
  );
}
