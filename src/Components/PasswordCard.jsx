import { useState } from "react";
import { Check, CircleCheck, KeyRound, TriangleAlert } from "lucide-react";
import Card from "./Card";
import PasswordInput from "./PasswordInput";
import { primaryButton, secondaryButton } from "./formStyles";
import useData from "../useData";

// A small tick or empty circle next to each password rule
function Rule({ ok, children }) {
  return (
    <li
      className={`flex items-center gap-2 text-xs ${ok ? "text-brand" : "text-muted"}`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
          ok ? "border-brand bg-brand text-white" : "border-line"
        }`}
      >
        {ok && <Check className="h-3 w-3" />}
      </span>
      {children}
    </li>
  );
}

// "Password" on the profile page: change your own password.
// Changing it signs you out on every other device.
export default function PasswordCard() {
  const { changePassword } = useData();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const longEnough = next.length >= 8;
  const matching = next.length > 0 && next === again;
  const ready = current && longEnough && matching && !busy;

  function reset() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setAgain("");
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await changePassword(current, next);
      reset();
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Password">
      {!open ? (
        <div className="grid gap-4 sm:flex sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <KeyRound className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted sm:flex-1">
            {done ? (
              <span className="flex items-center gap-1.5 text-brand">
                <CircleCheck className="h-4 w-4 shrink-0" />
                Password changed. Other devices have been signed out.
              </span>
            ) : (
              "Change the password you sign in with."
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setDone(false);
            }}
            className={secondaryButton}
          >
            Change password
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="current-password" className="text-sm font-medium">
              Current password
            </label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setError("");
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-sm font-medium">
              New password
            </label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password-again" className="text-sm font-medium">
              Type it again
            </label>
            <PasswordInput
              id="new-password-again"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>

          <ul className="flex flex-col gap-1.5">
            <Rule ok={longEnough}>At least 8 characters</Rule>
            <Rule ok={matching}>Both new passwords match</Rule>
          </ul>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="grid gap-2 border-t border-line pt-4 sm:flex sm:justify-end">
            <button type="button" onClick={reset} className={secondaryButton}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready}
              className={`${primaryButton} order-first disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand sm:order-last`}
            >
              {busy ? "Saving…" : "Save new password"}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
