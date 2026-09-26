import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowLeft, CircleCheck, TriangleAlert } from "lucide-react";
import AuthShell from "../AuthShell";
import PasswordInput from "../PasswordInput";
import { inputClass, labelClass } from "../formStyles";
import useData from "../../useData";

const fullButton =
  "h-11 w-full cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.98]";

// Sign in for everyone: staff go to the dashboard, customers to their portal.
// Coming here while signed in (the "Log out" links) signs you out first.
export default function Login() {
  const { me, team, login, logout, findMemberByEmail } = useData();
  const navigate = useNavigate();
  const location = useLocation();

  const [view, setView] = useState("signin"); // "signin" or "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null); // { text, inviteId? }
  const [resetSent, setResetSent] = useState(false);

  // Sign out once, when the page first opens
  const signedOut = useRef(false);
  useEffect(() => {
    if (signedOut.current) return;
    signedOut.current = true;
    if (me) logout();
  }, [me, logout]);

  function handleSignIn(e) {
    e.preventDefault();
    const member = findMemberByEmail(email);

    if (!member) {
      setError({ text: "We couldn't find an account with that email." });
      return;
    }
    if (member.status === "invited") {
      setError({
        text: "This account isn't set up yet. Open the invite link in your email to choose a password.",
        inviteId: member.id,
      });
      return;
    }

    // For now any password works. The backend will check it for real.
    login(member.id);
    const home = member.role === "customer" ? "/portal" : "/";
    const from = location.state?.from;
    const fromFits =
      from && (member.role === "customer") === from.startsWith("/portal");
    navigate(fromFits ? from : home, { replace: true });
  }

  function handleReset(e) {
    e.preventDefault();
    // Always the same answer, so nobody can use this to find out
    // which emails have accounts
    setResetSent(true);
  }

  // Quick sign-in buttons for testing, until real passwords exist
  const demoStaff = team.find((m) => m.role === "owner");
  const demoCustomer = team.find(
    (m) => m.role === "customer" && m.status === "active",
  );

  if (view === "reset") {
    return (
      <AuthShell title="Reset password">
        <button
          type="button"
          onClick={() => {
            setView("signin");
            setResetSent(false);
          }}
          className="mb-6 flex cursor-pointer items-center gap-1.5 text-sm text-muted transition hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </button>
        <h1 className="text-2xl font-semibold">Reset your password</h1>

        {resetSent ? (
          <p className="mt-6 flex items-start gap-3 rounded-lg bg-brand/10 p-4 text-sm text-brand">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
            If there's an account for {email.trim()}, we've sent it a link to
            choose a new password.
          </p>
        ) : (
          <form onSubmit={handleReset} className="mt-6 flex flex-col gap-4">
            <p className="text-sm text-muted">
              Enter your email and we'll send you a link to choose a new
              password.
            </p>
            <label className={labelClass}>
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>
            <button type="submit" className={fullButton}>
              Send reset link
            </button>
          </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">
        Sign in to your support account.
      </p>

      <form onSubmit={handleSignIn} className="mt-6 flex flex-col gap-4">
        <label className={labelClass}>
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            className={inputClass}
          />
        </label>

        {/* Not one big <label>, so clicking "Password" doesn't press
            the "Forgot password?" button */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <button
              type="button"
              onClick={() => {
                setView("reset");
                setError(null);
              }}
              className="cursor-pointer text-xs text-brand hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            id="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {error.text}
              {error.inviteId && (
                <>
                  {" "}
                  <Link
                    to={`/welcome/${error.inviteId}`}
                    className="font-medium underline"
                  >
                    Open the invite now
                  </Link>
                </>
              )}
            </span>
          </div>
        )}

        <button type="submit" className={fullButton}>
          Sign in
        </button>
      </form>

      {/* Testing helper, until the backend checks real passwords */}
      <div className="mt-8 rounded-xl border border-dashed border-line p-4">
        <p className="text-xs font-medium text-muted">
          Testing: any password works for now. Sign in as
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {[
            demoStaff && { label: "Staff", member: demoStaff },
            demoCustomer && { label: "Customer", member: demoCustomer },
          ]
            .filter(Boolean)
            .map(({ label, member }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setEmail(member.email);
                  setPassword("demo");
                  setError(null);
                }}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-page px-3 py-2 text-left text-sm transition hover:bg-brand/10"
              >
                <span className="min-w-0 truncate">{member.email}</span>
                <span className="shrink-0 text-xs text-muted">{label}</span>
              </button>
            ))}
        </div>
      </div>
    </AuthShell>
  );
}
