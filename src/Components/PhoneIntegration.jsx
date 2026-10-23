import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  KeyRound,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Trash2,
  Voicemail,
} from "lucide-react";
import Droplets from "./Droplets";
import KeywordInput from "./KeywordInput";
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
  ToggleRow,
} from "./integrationParts";
import { api } from "../api";
import { timeAgo } from "../data";

// Integrations → Phone (server/src/phone.js). Works with any phone system:
//   - voicemail emails: the phone system emails each voicemail to a
//     connected mailbox, and emails from its address become voicemail
//     tickets
//   - the call webhook: phone systems that can call a web address send
//     each call (and the recording) straight here
// Each extension is matched to an agent, so their voicemails go to them.

const EVENT = {
  voicemail: { label: "Voicemail", icon: Voicemail },
  missed: { label: "Missed", icon: PhoneMissed },
  answered: { label: "Answered", icon: PhoneIncoming },
  unanswered: { label: "Not answered", icon: PhoneOutgoing },
  other: { label: "Call", icon: PhoneCall },
};
const RESULT = {
  ticket: "made a ticket",
  added: "added to a ticket",
  noted: "noted on a ticket",
  logged: "",
};

function duration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function PhoneIntegration() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState("");
  const [extensions, setExtensions] = useState([]);
  const [senders, setSenders] = useState([]);
  const [confirmNewToken, setConfirmNewToken] = useState(false);

  function show(result) {
    setInfo(result);
    setExtensions(result.extensions.length ? result.extensions : []);
    setSenders(result.voicemailSenders);
  }

  useEffect(() => {
    api("/phone")
      .then(show)
      .catch((err) => setLoadError(err.message));
  }, []);

  async function save(what, body, message = "") {
    setBusy(what);
    setError("");
    setSaved("");
    try {
      show(await api("/phone", { method: "PUT", body }));
      if (message) setSaved(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function newToken() {
    setBusy("token");
    setError("");
    try {
      show(await api("/phone/token", { method: "POST" }));
      setConfirmNewToken(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const origin = window.location.origin;
  const hook = info?.token ? `${origin}/api/phone/hook/${info.token}` : "";
  const lookup = info?.token
    ? `${origin}/api/phone/lookup/${info.token}?number=`
    : "";
  const extensionsChanged =
    JSON.stringify(extensions.filter((e) => e.ext)) !==
    JSON.stringify(info?.extensions ?? []);
  const sendersChanged =
    JSON.stringify(senders) !== JSON.stringify(info?.voicemailSenders ?? []);

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
            <PhoneCall className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Phone (PBX)</h2>
            <p className="text-sm text-muted">
              Voicemails become tickets for the agent whose extension it was,
              and recorded calls go on the caller's ticket. The recording is
              attached to play back, and the caller is matched to the customer
              by their number. Works with any phone system: 3CX, FreePBX,
              Yeastar, Grandstream, hosted ones.
            </p>
          </div>
        </div>
        <OnOffPill on={Boolean(info?.enabled)} />
      </div>

      {loadError && <Alert>{loadError}</Alert>}
      {!info && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" />
          Loading…
        </p>
      )}

      {info && !info.enabled && (
        <div className="flex">
          <button
            type="button"
            disabled={busy === "enable"}
            onClick={() => save("enable", { enabled: true })}
            className="btn-glass flex h-8.5 sm:h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium transition active:scale-[0.97] disabled:opacity-60"
          >
            {busy === "enable" && <Droplets className="h-4 w-4" />}
            Turn on phone calls
          </button>
        </div>
      )}

      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="ok">{saved}</Alert>}

      {info?.enabled && (
        <>
          {/* Who each extension is */}
          <Part
            title="Extensions"
            hint="Which agent each extension belongs to, so their voicemails become their tickets. Voicemails for other extensions go to the team below."
          >
            {extensions.length > 0 && (
              <ul className="flex flex-col gap-2">
                {extensions.map((row, i) => (
                  <li key={i} className="flex gap-2">
                    <input
                      value={row.ext}
                      onChange={(e) =>
                        setExtensions((list) =>
                          list.map((r, k) =>
                            k === i
                              ? { ...r, ext: e.target.value.replace(/\D/g, "") }
                              : r,
                          ),
                        )
                      }
                      inputMode="numeric"
                      placeholder="204"
                      aria-label="Extension"
                      className={`${inputClass} w-24! shrink-0`}
                    />
                    <select
                      value={row.userId ?? ""}
                      onChange={(e) =>
                        setExtensions((list) =>
                          list.map((r, k) =>
                            k === i ? { ...r, userId: e.target.value } : r,
                          ),
                        )
                      }
                      aria-label="Agent"
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">Who is it?</option>
                      {info.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || a.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove extension ${row.ext}`}
                      onClick={() =>
                        setExtensions((list) => list.filter((_, k) => k !== i))
                      }
                      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition hover:border-red-200 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setExtensions((list) => [...list, { ext: "", userId: "" }])
                }
                className={`${secondaryButton} flex items-center justify-center gap-2`}
              >
                <Plus className="h-4 w-4" />
                Add an extension
              </button>
              {extensionsChanged && (
                <button
                  type="button"
                  disabled={busy === "extensions"}
                  onClick={() =>
                    save(
                      "extensions",
                      { extensions: extensions.filter((e) => e.ext) },
                      "Extensions saved.",
                    )
                  }
                  className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
                >
                  {busy === "extensions" && <Droplets className="h-4 w-4" />}
                  Save extensions
                </button>
              )}
            </div>

            <label className={labelClass}>
              <span>
                Team{" "}
                <span className="font-normal text-muted">
                  (for calls to an extension that isn't on the list)
                </span>
              </span>
              <select
                value={info.departmentId ?? ""}
                disabled={busy === "team"}
                onChange={(e) =>
                  save("team", { departmentId: e.target.value || null })
                }
                className={`${inputClass} cursor-pointer`}
              >
                <option value="">No team, the Inbox</option>
                {info.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </Part>

          {/* Way 1: voicemail emails */}
          <Part
            title="Way 1: voicemail emails (any phone system)"
            hint="The simplest way, and almost every phone system can do it."
          >
            <ol className="flex flex-col gap-4">
              <Step n={1}>
                <p>
                  In your phone system's voicemail settings, turn on{" "}
                  <strong>email voicemail, with the recording attached</strong>,
                  and send them to a mailbox connected in{" "}
                  <strong>Email</strong> above (e.g. support@yourcompany.com).
                  In 3CX it's each extension's Voicemail tab; in FreePBX,
                  Applications → Voicemail.
                </p>
              </Step>
              <Step n={2}>
                <p>
                  Add the address your phone system sends them from, then press
                  Enter. A whole domain works too, e.g. <code>@3cx.net</code>.
                </p>
                <KeywordInput
                  value={senders}
                  onChange={setSenders}
                  placeholder="pbx@yourcompany.com, then Enter"
                />
                {sendersChanged && (
                  <div className="flex">
                    <button
                      type="button"
                      disabled={busy === "senders"}
                      onClick={() =>
                        save(
                          "senders",
                          { voicemailSenders: senders },
                          "Saved. Voicemail emails from those addresses become voicemail tickets.",
                        )
                      }
                      className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
                    >
                      {busy === "senders" && <Droplets className="h-4 w-4" />}
                      Save addresses
                    </button>
                  </div>
                )}
              </Step>
              <Step n={3}>
                <p>
                  Leave a test voicemail. It shows up as a ticket within a
                  minute, and on the call list below. The caller's number,
                  the extension and the length are read from the email, and
                  the agent is the one whose extension it was (or whose
                  address the email went to).
                </p>
              </Step>
            </ol>
          </Part>

          {/* Way 2: the webhook */}
          <Part
            title="Way 2: the call webhook (phone systems that can call a link)"
            hint="Faster than email, and it can note answered calls too. Keep this address private: it works without signing in."
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Webhook address</p>
              <CopyRow value={hook} label="address" />
              <p className="text-sm text-muted">
                Send <code>event</code> (voicemail, missed or answered),{" "}
                <code>from</code> (the caller's number), <code>ext</code>,{" "}
                <code>duration</code> and the call's <code>id</code>, by GET
                or POST, with the recording as a file upload (or{" "}
                <code>recording=</code> a link to it). For FreePBX/Asterisk,
                the project has two ready-made scripts in{" "}
                <code>deploy/pbx</code>: one for voicemails, one for recorded
                calls.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                Caller lookup{" "}
                <span className="font-normal text-muted">
                  (for a screen pop, e.g. a 3CX CRM template)
                </span>
              </p>
              <CopyRow value={lookup} label="lookup" />
              <p className="text-sm text-muted">
                Put the caller's number on the end. It answers with the
                customer's name and company, and links to them and their open
                ticket.
              </p>
            </div>
            {confirmNewToken ? (
              <Alert tone="warn">
                <p>
                  The old address stops working straight away. Your phone
                  system needs the new one.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === "token"}
                    onClick={newToken}
                    className="h-9 cursor-pointer rounded-lg bg-amber-600 px-3 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Make a new address
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmNewToken(false)}
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
                  onClick={() => setConfirmNewToken(true)}
                  className={`${secondaryButton} flex items-center justify-center gap-2`}
                >
                  <KeyRound className="h-4 w-4" />
                  Make a new address
                </button>
              </div>
            )}
          </Part>

          {/* What happens to calls */}
          <Part title="What happens to calls">
            <ToggleRow
              title="Missed calls become tickets"
              hint="A missed call with no voicemail gets a ticket too, so someone calls them back. Off: only voicemails do. (Webhook only: emails are always voicemails.)"
              on={info.missedCalls}
              disabled={busy === "missed"}
              onChange={(on) => save("missed", { missedCalls: on })}
            />
            <ToggleRow
              title="Recorded calls go on tickets"
              hint="When your phone system records calls, each recording goes on the caller's open ticket (or a new one, if they have none), to play back. Turn on call recording in the phone system, and have it send the recording to the webhook when the call ends."
              on={info.recordedCalls}
              disabled={busy === "recorded"}
              onChange={(on) => save("recorded", { recordedCalls: on })}
            />
            <ToggleRow
              title="Note answered calls"
              hint={`For calls that weren't recorded: when a customer with an unfinished ticket calls and someone picks up, a note goes on that ticket: "Call from Keisha, 3:05". (Webhook only.)`}
              on={info.logCalls}
              disabled={busy === "log"}
              onChange={(on) => save("log", { logCalls: on })}
            />
          </Part>

          {/* The last calls */}
          <Part
            title="Recent calls"
            hint={
              info.calls.length
                ? "The last 20 calls the phone system sent."
                : "Calls appear here as they come in."
            }
          >
            {info.calls.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {info.calls.map((c) => {
                  const kind = EVENT[c.event] ?? EVENT.other;
                  const Icon = kind.icon;
                  return (
                    <li key={c.id} className="flex items-center gap-3 p-3">
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {c.name || c.number || "Hidden number"}
                          {c.name && c.number && (
                            <span className="font-normal text-muted">
                              {" "}
                              {c.number}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted">
                          {kind.label}
                          {c.duration ? `, ${duration(c.duration)}` : ""}
                          {c.extension ? `, ext ${c.extension}` : ""}
                          {c.agentName ? ` (${c.agentName})` : ""}
                          {c.via === "email" ? ", by email" : ""}
                          {RESULT[c.result] ? `: ${RESULT[c.result]}` : ""}
                          {`, ${timeAgo(c.at)}`}
                        </p>
                      </div>
                      {c.ticketId && (
                        <Link
                          to={`/tickets/${c.ticketId}`}
                          className="shrink-0 text-sm text-brand hover:underline"
                        >
                          #{c.ticketId}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Part>

          <div className="flex border-t border-line pt-5">
            <button
              type="button"
              disabled={busy === "disable"}
              onClick={() => save("disable", { enabled: false })}
              className={secondaryButton}
            >
              Turn off phone calls
            </button>
          </div>
        </>
      )}
    </section>
  );
}
