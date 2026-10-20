import { useEffect, useRef, useState } from "react";
import { MailCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import PasswordInput from "./PasswordInput";
import { inputClass, primaryButton, secondaryButton } from "./formStyles";
import { api, setConfirmationAsker } from "../api";

// Asks for the code before an important action goes through (removing
// someone, changing access, restoring a backup, changing integrations:
// the list is in server/src/confirm.js). The server answers those with
// "confirm first"; api.js then asks here, and sends the action again with
// the code. Put once near the top of the app (App.jsx).
//   method "email":    a 6-digit code is emailed to you
//   method "password": no company mailbox yet (e.g. a brand-new site
//                      being restored), so your password instead
export default function ConfirmGate() {
  const [ask, setAsk] = useState(null); // { action, method, error, resolve, n }
  const asked = useRef(0); // a fresh box each time (e.g. after a wrong code)

  useEffect(() => {
    setConfirmationAsker(
      (request) =>
        new Promise((resolve) => {
          asked.current += 1;
          setAsk({ ...request, resolve, n: asked.current });
        }),
    );
    return () => setConfirmationAsker(null);
  }, []);

  if (!ask) return null;
  return (
    <ConfirmModal
      key={ask.n}
      ask={ask}
      onDone={(answer) => {
        ask.resolve(answer);
        setAsk(null);
      }}
    />
  );
}

function ConfirmModal({ ask, onDone }) {
  const byEmail = ask.method === "email";
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(ask.error ?? "");
  const sentOnce = useRef(false);

  async function send() {
    setSending(true);
    setError("");
    try {
      const { sentTo: to } = await api("/confirm/send", {
        method: "POST",
        body: { action: ask.action },
      });
      setSentTo(to);
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  }

  // The first time: send the code straight away (not again after a
  // wrong code, so the one already in the inbox still works)
  useEffect(() => {
    if (byEmail && !ask.error && !sentOnce.current) {
      sentOnce.current = true;
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = byEmail ? code.length === 6 : password.length > 0;

  return (
    <Modal
      title="Confirm it's you"
      onClose={() => onDone(null)}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onDone(byEmail ? { code } : { password });
      }}
      footer={
        <>
          <button
            type="button"
            onClick={() => onDone(null)}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Confirm
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          {byEmail ? (
            <MailCheck className="h-5 w-5" />
          ) : (
            <ShieldCheck className="h-5 w-5" />
          )}
        </span>
        <p className="text-sm">
          To <span className="font-medium">{ask.action}</span>,{" "}
          {byEmail
            ? sentTo
              ? `type the 6-digit code we just emailed to ${sentTo}.`
              : sending
                ? "we're emailing you a code…"
                : "we'll email you a 6-digit code."
            : "type your password. (Codes are emailed once a company mailbox is connected in Integrations → Email.)"}
        </p>
      </div>

      {byEmail ? (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            aria-label="Code"
            className={`${inputClass} font-mono tracking-[0.3em]`}
          />
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="cursor-pointer self-start text-xs text-brand hover:underline disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send a new code"}
          </button>
        </div>
      ) : (
        <PasswordInput
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          aria-label="Your password"
        />
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <p className="text-xs text-muted">
        After this, other important changes in the next 10 minutes won't ask
        again.
      </p>
    </Modal>
  );
}
