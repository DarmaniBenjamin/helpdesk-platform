import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, Mail, CircleAlert } from "lucide-react";
import AuthShell from "../AuthShell";
import PasswordInput from "../PasswordInput";
import { inputClass, labelClass } from "../formStyles";
import { ROLES } from "../teamRoles";
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

// The page an invite email links to (/welcome/<id>): the person picks a
// name and password, and is signed straight in
export default function AcceptInvite() {
  const { id } = useParams();
  const { team, acceptInvite } = useData();
  const navigate = useNavigate();
  const member = team.find((m) => m.id === id);

  const [name, setName] = useState(member?.name ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const longEnough = password.length >= 8;
  const matches = password.length > 0 && password === confirm;

  // Link doesn't work (cancelled, or already used)
  if (!member || member.status !== "invited") {
    return (
      <AuthShell title="Invite">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleAlert className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold">
            {member ? "You're already set up" : "This invite has expired"}
          </h1>
          <p className="text-sm text-muted">
            {member
              ? "This account already has a password. Sign in to carry on."
              : "It may have been cancelled. Ask whoever invited you to send a new one."}
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

  const isCustomer = member.role === "customer";

  function handleSubmit(e) {
    e.preventDefault();
    if (!longEnough || !matches) return;
    // The backend will save the password. For now it isn't kept.
    acceptInvite(member.id, name);
    navigate(isCustomer ? "/portal" : "/", { replace: true });
  }

  return (
    <AuthShell title="Welcome">
      <h1 className="text-2xl font-semibold">Welcome to Ticket Support</h1>
      <p className="mt-1 text-sm text-muted">
        {isCustomer
          ? "You've been invited to the customer portal, where you can send and follow your support requests."
          : `You've been invited to join the team as ${
              /^[AEIOU]/.test(ROLES[member.role].label) ? "an" : "a"
            } ${ROLES[member.role].label}.`}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm text-muted ring-1 ring-line">
          <Mail className="h-4 w-4 shrink-0" />
          <span className="truncate">{member.email}</span>
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

        <button
          type="submit"
          disabled={!longEnough || !matches || !name.trim()}
          className={fullButton}
        >
          Create my account
        </button>
      </form>
    </AuthShell>
  );
}
