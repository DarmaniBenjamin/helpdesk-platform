import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, CircleAlert, Mail, TriangleAlert } from "lucide-react";
import AuthShell from "../AuthShell";
import PasswordInput from "../PasswordInput";
import { labelClass } from "../formStyles";
import { api } from "../../api";
import useData from "../../useData";

const fullButton =
  "h-11 w-full cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

// A rule under the password box that ticks itself when it's met
function Rule({ ok, children }) {
  return (
    <li
      className={`flex items-center gap-2 text-xs ${ok ? "text-brand" : "text-muted"}`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          ok ? "bg-brand text-white" : "border border-line"
        }`}
      >
        {ok && <Check className="h-3 w-3" />}
      </span>
      {children}
    </li>
  );
}

// The page the "forgot password" email links to (/reset/<token>): choose
// a new password, and you're signed straight in. The link works once,
// for an hour (server/src/notices.js).
export default function ResetPassword() {
  const { token } = useParams();
  const { resetPassword } = useData();
  const navigate = useNavigate();

  const [state, setState] = useState("loading"); // "loading", "ready", "invalid"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Is the link still good?
  useEffect(() => {
    let cancelled = false;
    api(`/password/reset/${token}`)
      .then((data) => {
        if (cancelled) return;
        setEmail(data.email);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const longEnough = password.length >= 8;
  const matches = password.length > 0 && password === confirm;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!longEnough || !matches) return;
    setBusy(true);
    setError("");
    try {
      const user = await resetPassword(token, password);
      navigate(user.role === "customer" ? "/portal" : "/", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <AuthShell title="New password">
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
        </div>
      </AuthShell>
    );
  }

  if (state === "invalid") {
    return (
      <AuthShell title="New password">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleAlert className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold">This link doesn't work</h1>
          <p className="text-sm text-muted">
            It may have been used already, or it's more than an hour old. Ask
            for a new one from the sign-in page.
          </p>
          <Link
            to="/login"
            className="mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand/90"
          >
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="New password">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted">
        You'll be signed out everywhere else, and signed in here.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm text-muted ring-1 ring-line">
          <Mail className="h-4 w-4 shrink-0" />
          <span className="truncate">{email}</span>
        </div>

        <label className={labelClass}>
          New password
          <PasswordInput
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className={labelClass}>
          Type it again
          <PasswordInput
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        <ul className="flex flex-col gap-1.5">
          <Rule ok={longEnough}>At least 8 characters</Rule>
          <Rule ok={matches}>Both passwords match</Rule>
        </ul>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!longEnough || !matches || busy}
          className={fullButton}
        >
          {busy ? "Saving…" : "Save and sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
