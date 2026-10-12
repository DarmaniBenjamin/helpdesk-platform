import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, Plus, Smartphone, Trash2 } from "lucide-react";
import Droplets from "./Droplets";
import Modal from "./Modal";
import PasswordInput from "./PasswordInput";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import {
  Alert,
  CopyRow,
  OnOffPill,
  Part,
  Step,
  Toggle,
} from "./integrationParts";
import { api } from "../api";
import { timeAgo } from "../data";

// Integrations → WhatsApp (server/src/whatsapp.js). Each agent's WhatsApp
// Business number is connected once, through Meta's own window ("Embedded
// Signup", coexistence mode): the agent keeps using the WhatsApp Business
// app on their phone, and the helpdesk gets a copy of every message, both
// ways. Customers' messages become tickets for that agent; what the agent
// sends from the app goes on the ticket as their reply.

// Facebook's sign-in script, loaded once (Meta's window needs it)
let facebook = null;
function loadFacebook(appId, version) {
  facebook ??= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => resolve(window.FB);
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      facebook = null;
      reject(
        new Error(
          "Facebook's sign-in didn't load. Check the connection, or turn off an ad blocker for this site.",
        ),
      );
    };
    document.body.appendChild(script);
  });
  return facebook.then((FB) => {
    FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
    return FB;
  });
}

// Setting up the Meta app, step by step (once)
function MetaAppSetup({ info, onSaved }) {
  const [open, setOpen] = useState(!info.appId);
  const [appId, setAppId] = useState(info.appId);
  const [configId, setConfigId] = useState(info.configId);
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = window.location.origin;
  const webhook = `${origin}/api/whatsapp/webhook`;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api("/whatsapp/app", {
          method: "PUT",
          body: { appId, configId, appSecret },
        }),
      );
      setAppSecret("");
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Part
      title="The Meta app"
      hint={
        info.appId
          ? `Set up (App ID ${info.appId}). ${info.lastWebhookAt ? `Last message from Meta ${timeAgo(info.lastWebhookAt)}.` : "No messages from Meta yet."}`
          : "Made once, at developers.facebook.com. It's what lets the helpdesk read your WhatsApp Business numbers."
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-fit cursor-pointer items-center gap-1 text-sm text-brand hover:underline"
      >
        {open ? "Hide the steps" : "Show the steps"}
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <form onSubmit={save} className="flex flex-col gap-4">
          <ol className="flex flex-col gap-4">
            <Step n={1}>
              <p>
                On{" "}
                <a
                  href="https://developers.facebook.com/apps"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  developers.facebook.com/apps
                </a>
                , <strong>Create app</strong>, type <strong>Business</strong>,
                linked to your company's Meta Business portfolio. Add the{" "}
                <strong>WhatsApp</strong> and{" "}
                <strong>Facebook Login for Business</strong> products.
              </p>
            </Step>
            <Step n={2}>
              <p>
                <strong>App settings → Basic</strong>: add your domain to{" "}
                <strong>App domains</strong>. Then{" "}
                <strong>Facebook Login for Business → Settings</strong>: turn
                on <strong>Login with the JavaScript SDK</strong> and add this
                to <strong>Allowed domains for the JavaScript SDK</strong>:
              </p>
              <CopyRow value={origin} label="domain" />
            </Step>
            <Step n={3}>
              <p>
                <strong>Facebook Login for Business → Configurations</strong>:
                create one for <strong>WhatsApp Embedded Signup</strong>, with
                the <code>whatsapp_business_management</code> and{" "}
                <code>whatsapp_business_messaging</code> permissions. Copy its{" "}
                <strong>Configuration ID</strong> below.
              </p>
            </Step>
            <Step n={4}>
              <p>
                <strong>WhatsApp → Configuration → Webhook</strong>: paste this{" "}
                <strong>Callback URL</strong> and <strong>Verify token</strong>,
                then subscribe to <code>messages</code> and{" "}
                <code>smb_message_echoes</code>:
              </p>
              <CopyRow value={webhook} label="URL" />
              <CopyRow value={info.verifyToken ?? ""} label="token" />
            </Step>
            <Step n={5}>
              <p>
                Paste the App ID, App secret (App settings → Basic) and
                Configuration ID here and save. Meta asks you to verify your
                business before connecting real numbers works (Business
                Settings → Security Centre); that can take a few days.
              </p>
            </Step>
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span>App ID</span>
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value.trim())}
                inputMode="numeric"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              <span>Configuration ID</span>
              <input
                value={configId}
                onChange={(e) => setConfigId(e.target.value.trim())}
                inputMode="numeric"
                className={inputClass}
              />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              <span>
                App secret{" "}
                {info.hasSecret && (
                  <span className="font-normal text-muted">
                    (saved; leave empty to keep it)
                  </span>
                )}
              </span>
              <PasswordInput
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value.trim())}
                autoComplete="off"
              />
            </label>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex">
            <button
              type="submit"
              disabled={busy}
              className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
            >
              {busy && <Droplets className="h-4 w-4" />}
              Save the Meta app
            </button>
          </div>
        </form>
      )}
    </Part>
  );
}

// Adding a number by hand: one that's only on the Cloud API
function ManualModal({ info, onClose, onSaved }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      title="Add a number by hand"
      onClose={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          onSaved(
            await api("/whatsapp/numbers/manual", {
              method: "POST",
              body: { phoneNumberId, wabaId, token, userId: userId || null },
            }),
          );
          onClose();
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`${primaryButton} disabled:opacity-60`}
          >
            {busy ? "Checking…" : "Add number"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          For a number that's only on the WhatsApp Cloud API (not on a phone).
          The IDs are in your Meta app under{" "}
          <strong>WhatsApp → API Setup</strong>. Use a lasting token: a System
          User's, made in Meta Business Settings → Users → System users, with
          the two WhatsApp permissions.
        </p>
        <label className={labelClass}>
          <span>Phone number ID</span>
          <input
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value.trim())}
            inputMode="numeric"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>WhatsApp Business Account ID</span>
          <input
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value.trim())}
            inputMode="numeric"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>Access token</span>
          <PasswordInput
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            autoComplete="off"
          />
        </label>
        <label className={labelClass}>
          <span>Whose number is it?</span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Nobody's: tickets go to the Inbox</option>
            {info.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email}
              </option>
            ))}
          </select>
        </label>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

function NumberRow({ number, info, onSaved }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function change(what, request) {
    setBusy(what);
    setError("");
    try {
      onSaved(await request());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }
  const save = (what, body) =>
    change(what, () =>
      api(`/whatsapp/numbers/${number.id}`, { method: "PATCH", body }),
    );

  return (
    <li className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {number.displayNumber || number.phoneNumberId}
            {number.name && (
              <span className="font-normal text-muted"> {number.name}</span>
            )}
          </p>
          <p className="text-xs text-muted">
            {number.coexistence
              ? "On the WhatsApp Business app too"
              : "Cloud API only"}
            {number.lastMessageAt
              ? `, last message ${timeAgo(number.lastMessageAt)}`
              : ", no messages yet"}
          </p>
        </div>
        <Toggle
          on={number.enabled}
          label={`Read ${number.displayNumber}`}
          disabled={busy === "enabled"}
          onChange={(on) => save("enabled", { enabled: on })}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Agent</span>
          <select
            value={number.userId ?? ""}
            disabled={busy === "agent"}
            onChange={(e) => save("agent", { userId: e.target.value || null })}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Nobody: the Inbox</option>
            {info.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Team</span>
          <select
            value={number.departmentId ?? ""}
            disabled={busy === "team"}
            onChange={(e) =>
              save("team", { departmentId: e.target.value || null })
            }
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">No team</option>
            {info.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {confirmRemove ? (
        <Alert tone="warn">
          <p>
            The helpdesk stops reading this number. Its tickets stay. The agent
            keeps using WhatsApp as normal (to take it off Meta's platform
            completely, they disconnect it in the WhatsApp Business app:
            Settings → Account → Business Platform).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy === "remove"}
              onClick={() =>
                change("remove", () =>
                  api(`/whatsapp/numbers/${number.id}`, { method: "DELETE" }),
                )
              }
              className="h-9 cursor-pointer rounded-lg bg-amber-600 px-3 text-sm font-medium text-white disabled:opacity-60"
            >
              Remove it
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="h-9 cursor-pointer rounded-lg px-3 text-sm"
            >
              Cancel
            </button>
          </div>
        </Alert>
      ) : (
        <div className="flex">
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

export default function WhatsAppIntegration() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [connectFor, setConnectFor] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [manual, setManual] = useState(false);
  const [fb, setFb] = useState(null);

  useEffect(() => {
    api("/whatsapp")
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  }, []);

  const appId = info?.appId;
  const graphVersion = info?.graphVersion;
  const ready = Boolean(appId && info?.configId && info?.hasSecret);

  // Facebook's script is loaded as soon as the app is set up, so the
  // window can open straight from the click (browsers block pop-ups that
  // open later)
  useEffect(() => {
    if (!ready) return;
    loadFacebook(appId, graphVersion)
      .then(setFb)
      .catch((err) => setError(err.message));
  }, [ready, appId, graphVersion]);

  function connect() {
    if (!fb) return;
    setError("");
    setConnecting(true);
    // Meta's window tells this page which number was connected, separately
    // from the sign-in code
    let session = null;
    const listen = (event) => {
      let host = "";
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!/(^|\.)facebook\.com$/.test(host)) return;
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (String(data.event).startsWith("FINISH")) session = data.data ?? {};
      else if (data.event === "CANCEL")
        session = { cancelled: true, step: data.data?.current_step };
      else if (data.event === "ERROR")
        session = { error: data.data?.error_message };
    };
    window.addEventListener("message", listen);

    fb.login(
      (response) => {
        // The number's details can arrive just after this
        setTimeout(async () => {
          window.removeEventListener("message", listen);
          const code = response?.authResponse?.code;
          try {
            if (session?.error) throw new Error(`Meta said: ${session.error}`);
            if (!code || session?.cancelled)
              throw new Error(
                "The window was closed before the end, so nothing was connected.",
              );
            if (!session?.phone_number_id)
              throw new Error(
                "Meta didn't say which number was connected. Try again, and go through every step.",
              );
            setInfo(
              await api("/whatsapp/numbers/signup", {
                method: "POST",
                body: {
                  code,
                  phoneNumberId: session.phone_number_id,
                  wabaId: session.waba_id,
                  userId: connectFor || null,
                },
              }),
            );
          } catch (err) {
            setError(err.message);
          } finally {
            setConnecting(false);
          }
        }, 1500);
      },
      {
        config_id: info.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  const live = Boolean(info?.numbers.some((n) => n.enabled));

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">WhatsApp</h2>
            <p className="text-sm text-muted">
              Messages and voice notes sent to each agent's WhatsApp Business
              number become tickets for that agent. They keep using the
              WhatsApp Business app on their phone as normal, and what they
              reply there goes on the ticket too. Free: the helpdesk only
              reads, it never sends.
            </p>
          </div>
        </div>
        <OnOffPill on={live} />
      </div>

      {loadError && <Alert>{loadError}</Alert>}
      {!info && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" />
          Loading…
        </p>
      )}

      {info && (
        <>
          <MetaAppSetup info={info} onSaved={setInfo} />

          <Part
            title="Numbers"
            hint={
              info.numbers.length
                ? "Each number's messages become tickets for its agent."
                : "Connect each agent's WhatsApp Business number, once."
            }
          >
            {info.numbers.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {info.numbers.map((n) => (
                  <NumberRow
                    key={n.id}
                    number={n}
                    info={info}
                    onSaved={setInfo}
                  />
                ))}
              </ul>
            )}

            {ready ? (
              <div className="flex flex-col gap-3 rounded-lg bg-page p-3 sm:p-4">
                <p className="text-sm">
                  <strong>Connect a number.</strong> Have the agent's phone
                  ready, with the WhatsApp Business app up to date. Meta's
                  window opens: sign in with Facebook, pick your business, enter
                  the number, then scan the code it shows with the WhatsApp
                  Business app. Chats, contacts and everything else stay on the
                  phone as they are.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={connectFor}
                    onChange={(e) => setConnectFor(e.target.value)}
                    aria-label="Whose number"
                    className={`${inputClass} cursor-pointer sm:max-w-xs`}
                  >
                    <option value="">Whose number is it?</option>
                    {info.agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!fb || connecting}
                    onClick={connect}
                    className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
                  >
                    {connecting || !fb ? (
                      <Droplets className="h-4 w-4" />
                    ) : (
                      <Smartphone className="h-4 w-4" />
                    )}
                    Connect a number
                  </button>
                </div>
              </div>
            ) : (
              <Alert tone="warn">
                Set up the Meta app above first: then each agent's number can be
                connected from here.
              </Alert>
            )}

            {error && <Alert>{error}</Alert>}

            <div className="flex">
              <button
                type="button"
                onClick={() => setManual(true)}
                className={`${secondaryButton} flex items-center justify-center gap-2`}
              >
                <Plus className="h-4 w-4" />
                Add a Cloud API number by hand
              </button>
            </div>
          </Part>
        </>
      )}

      {manual && info && (
        <ManualModal
          info={info}
          onClose={() => setManual(false)}
          onSaved={setInfo}
        />
      )}
    </section>
  );
}
