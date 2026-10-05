import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import AuthShell from "../AuthShell";
import Droplets from "../Droplets";
import PasswordInput from "../PasswordInput";
import { inputClass, labelClass } from "../formStyles";
import { api } from "../../api";
import useData from "../../useData";

const fullButton =
  "h-11 w-full cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

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

// A brand-new server's first page (/setup/<code>, the link printed at the
// end of deploy/install.sh): make the Super Admin, and you're signed in.
// Then: Settings → Domain & SSL for the domain, and Settings → Backup →
// Copies in the cloud to bring everything back from Backblaze.
export default function SetupOwner() {
  const { code } = useParams();
  const { setupOwner } = useData();
  const navigate = useNavigate();
  const [state, setState] = useState("loading"); // "loading", "ready", "invalid"
  const [why, setWhy] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api(`/setup-owner/${code}`)
      .then(() => !cancelled && setState("ready"))
      .catch((err) => {
        if (cancelled) return;
        setWhy(err.message);
        setState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const longEnough = password.length >= 8;
  const matches = password.length > 0 && password === confirm;

  async function submit(e) {
    e.preventDefault();
    if (!longEnough || !matches || busy) return;
    setBusy(true);
    setError("");
    try {
      await setupOwner(code, { name, email, password });
      navigate("/settings?tab=backup", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (state === "loading")
    return (
      <AuthShell title="Set up">
        <div className="flex justify-center py-10">
          <Droplets className="h-10 w-10 text-brand" />
        </div>
      </AuthShell>
    );

  if (state === "invalid")
    return (
      <AuthShell title="Set up">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleAlert className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold">This link doesn't work</h1>
          <p className="text-sm text-muted">{why}</p>
          <Link
            to="/login"
            className="mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand/90"
          >
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell title="Set up">
      <h1 className="text-2xl font-semibold">Welcome to your new helpdesk</h1>
      <p className="mt-1 text-sm text-muted">
        Make the Super Admin account. Next, you'll connect your domain and bring
        your data back from your cloud backup.
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <label className={labelClass}>
          Your name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Password
          <PasswordInput
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className={labelClass}>
          Type it again
          <PasswordInput
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
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
          disabled={!longEnough || !matches || busy || !name || !email}
          className={fullButton}
        >
          {busy ? "Setting up…" : "Create and sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
