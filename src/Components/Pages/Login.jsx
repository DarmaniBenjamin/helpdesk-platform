import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowLeft, CircleCheck, TriangleAlert } from "lucide-react";
import AuthShell from "../AuthShell";
import SignInAnimation from "../SignInAnimation";
import PasswordInput from "../PasswordInput";
import { inputClass, labelClass } from "../formStyles";
import useData from "../../useData";

const fullButton =
  "h-11 w-full cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70";

// Sign in for everyone: staff go to the dashboard, customers to their portal.
// The password is checked by the server. Coming here while signed in (the
// "Log out" links) signs you out first.
export default function Login() {
  const { me, authChecked, signIn, logout } = useData();
  const navigate = useNavigate();
  const location = useLocation();

  const [view, setView] = useState("signin"); // "signin" or "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // "Forgot password?" only shows once a sign-in hasn't worked
  const [showForgot, setShowForgot] = useState(false);

  // Sign out once, as soon as we know who's signed in. After that, this
  // page is just for signing in.
  const handled = useRef(false);
  useEffect(() => {
    if (!authChecked || handled.current) return;
    handled.current = true;
    if (me) logout();
  }, [authChecked, me, logout]);

  // Where to go after signing in: back to the page they were trying to
  // open, if it's the right side of the app for them
  function goHome(role) {
    const home = role === "customer" ? "/portal" : "/";
    const from = location.state?.from;
    const fromFits =
      from && (role === "customer") === from.startsWith("/portal");
    navigate(fromFits ? from : home, { replace: true });
  }

  // The animation while signing in (SignInAnimation): null when it isn't
  // showing, otherwise "loading", "done" or "failed". Who signed in is
  // kept until the arrow has flown off, then the app opens.
  const [animation, setAnimation] = useState(null);
  const signedIn = useRef(null);
  const reduceMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function handleSignIn(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    // With "reduce motion" on, no animation: straight in
    if (!reduceMotion()) setAnimation("loading");
    try {
      const user = await signIn(email, password);
      signedIn.current = user;
      if (reduceMotion()) goHome(user.role);
      else setAnimation("done"); // the arrow takes off, then goHome
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setAnimation((a) => (a ? "failed" : null)); // drains away
      // A wrong email or password (not "can't reach the server")
      if (err.status === 401) setShowForgot(true);
    }
  }

  function handleReset(e) {
    e.preventDefault();
    // Always the same answer, so nobody can use this to find out which
    // emails have accounts. The email itself gets sent once email is
    // connected to the backend.
    setResetSent(true);
  }

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
              setError("");
            }}
            className={inputClass}
          />
        </label>

        {/* Not one big <label>, so clicking "Password" doesn't press
            the "Forgot password?" button under it */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <PasswordInput
            id="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />
          {/* Only after a sign-in hasn't worked */}
          {showForgot && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setView("reset");
                  setError("");
                }}
                className="cursor-pointer text-xs text-brand hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={busy} className={fullButton}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {animation && (
        <SignInAnimation
          status={animation}
          onFinished={() => goHome(signedIn.current.role)}
          onCancelled={() => setAnimation(null)}
        />
      )}
    </AuthShell>
  );
}
