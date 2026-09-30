import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, Mail, CircleAlert, TriangleAlert } from "lucide-react";
import AuthShell from "../AuthShell";
import PasswordInput from "../PasswordInput";
import { inputClass, labelClass } from "../formStyles";
import { ROLES } from "../teamRoles";
import { api } from "../../api";
import { APP_NAME } from "../../brand";
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

// The page an invite link opens (/welcome/<token>): the person picks
// their name and password, and is signed straight in. The token in the
// address is checked by the server, and only works once.
export default function AcceptInvite() {
  const { id: token } = useParams();
  const { acceptInvite } = useData();
  const navigate = useNavigate();

  // "loading", "ready" or "invalid"
  const [state, setState] = useState("loading");
  const [invite, setInvite] = useState(null); // { email, name, title, role }
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Ask the server who this invite is for
  useEffect(() => {
    let cancelled = false;
    api(`/invites/${token}`)
      .then((data) => {
        if (cancelled) return;
        setInvite(data);
        setName(data.name);
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
    if (!longEnough || !matches || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const user = await acceptInvite(token, name, password);
      navigate(user.role === "customer" ? "/portal" : "/", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <AuthShell title="Invite">
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
        </div>
      </AuthShell>
    );
  }

  // The link doesn't work: used already, cancelled, or more than 7 days old
  if (state === "invalid") {
    return (
      <AuthShell title="Invite">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleAlert className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold">This invite doesn't work</h1>
          <p className="text-sm text-muted">
            It may have been used already, cancelled, or it's more than 7 days
            old. If you've already set up your account, just sign in. Otherwise,
            ask whoever invited you to send a new link.
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

  const isCustomer = invite.role === "customer";
  const roleLabel = ROLES[invite.role].label;

  return (
    <AuthShell title="Welcome">
      <h1 className="text-2xl font-semibold">Welcome to {APP_NAME}</h1>
      <p className="mt-1 text-sm text-muted">
        {isCustomer
          ? "You've been invited to the customer portal, where you can send and follow your support requests."
          : `You've been invited to join the team as ${
              /^[AEIOU]/.test(roleLabel) ? "an" : "a"
            } ${roleLabel}${invite.title ? ` (${invite.title})` : ""}.`}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm text-muted ring-1 ring-line">
          <Mail className="h-4 w-4 shrink-0" />
          <span className="truncate">{invite.email}</span>
        </div>

        <label className={labelClass}>
          Your name
          <input
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Choose a password
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
          disabled={!longEnough || !matches || !name.trim() || busy}
          className={fullButton}
        >
          {busy ? "Setting up…" : "Create my account"}
        </button>
      </form>
    </AuthShell>
  );
}
