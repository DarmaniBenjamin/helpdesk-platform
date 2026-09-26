import { useState } from "react";
import { CircleCheck, Check, Mail } from "lucide-react";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { ROLES, PICKABLE_ROLES } from "./teamRoles";
import { DEPARTMENTS } from "../data";
import useData from "../useData";

// Invite someone new (no `member` passed) or change an existing member's
// name, role and teams
export default function MemberModal({ member, onClose }) {
  const { inviteMember, updateMember, findMemberByEmail } = useData();
  const editing = Boolean(member);

  const [email, setEmail] = useState(member?.email ?? "");
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(member?.role ?? "agent");
  const [departments, setDepartments] = useState(member?.departments ?? []);
  const [error, setError] = useState("");
  // After inviting, show a "done" screen instead of the form
  const [invited, setInvited] = useState(null);

  function toggleDepartment(id) {
    setDepartments((list) =>
      list.includes(id) ? list.filter((d) => d !== id) : [...list, id],
    );
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (editing) {
      updateMember(member.id, { name: name.trim(), role, departments });
      document.activeElement?.blur();
      onClose();
      return;
    }

    // Nobody can be on the team twice
    const existing = findMemberByEmail(email);
    if (existing) {
      setError(
        existing.status === "invited"
          ? "This person already has an invite waiting."
          : "This person is already on the team.",
      );
      return;
    }

    document.activeElement?.blur();
    setInvited(inviteMember({ email, name, role, departments }));
  }

  // ----- The "invite sent" screen -----
  if (invited) {
    return (
      <Modal
        title="Invite ready"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose} className={primaryButton}>
            Done
          </button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="h-12 w-12 text-brand" />
          <p className="text-sm">
            <span className="font-semibold">{invited.email}</span> was invited
            as {/^[AEIOU]/.test(ROLES[invited.role].label) ? "an" : "a"}{" "}
            <span className="font-semibold">{ROLES[invited.role].label}</span>.
          </p>
          <p className="text-sm text-muted">
            Once email is connected, they'll get a link to set their password
            and sign in.
          </p>
          <p className="text-xs text-muted">
            They show as "Invited" on the Team page until then.
          </p>
        </div>
      </Modal>
    );
  }

  // ----- The form -----
  return (
    <Modal
      title={editing ? "Edit team member" : "Invite team member"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" className={primaryButton}>
            {editing ? "Save" : "Send invite"}
          </button>
        </>
      }
    >
      {editing ? (
        <div className="flex items-center gap-2 rounded-lg bg-page px-3 py-2.5 text-sm text-muted">
          <Mail className="h-4 w-4 shrink-0" />
          <span className="truncate">{member.email}</span>
        </div>
      ) : (
        <label className={labelClass}>
          Email address
          <input
            required
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            placeholder="name@company.com"
            className={`${inputClass} ${error ? "border-red-400" : ""}`}
          />
          {error && (
            <span className="text-xs font-normal text-red-500">{error}</span>
          )}
        </label>
      )}

      <label className={labelClass}>
        <span>
          Name{" "}
          {!editing && (
            <span className="font-normal text-muted">(optional)</span>
          )}
        </span>
        <input
          required={editing && member.status === "active"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jordan Baptiste"
          className={inputClass}
        />
        {!editing && (
          <span className="text-xs font-normal text-muted">
            They can change it when they sign up.
          </span>
        )}
      </label>

      {/* Role: one card per role, with what it can do */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Role</legend>
        {PICKABLE_ROLES.map((id) => {
          const { label, description, icon } = ROLES[id];
          const Icon = icon;
          const selected = role === id;
          return (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition active:scale-[0.99] ${
                selected
                  ? "border-brand bg-brand/5"
                  : "border-line hover:border-brand/30 hover:bg-brand/5"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={id}
                checked={selected}
                onChange={() => setRole(id)}
                className="sr-only"
              />
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  selected ? "bg-brand text-white" : "bg-page text-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted">{description}</span>
              </span>
              {selected && (
                <Check className="mt-1 h-4 w-4 shrink-0 text-brand" />
              )}
            </label>
          );
        })}
      </fieldset>

      {/* Teams: tap to switch each one on or off */}
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Teams</p>
        <div className="flex flex-wrap gap-2">
          {DEPARTMENTS.map((d) => {
            const on = departments.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDepartment(d.id)}
                className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition active:scale-[0.97] ${
                  on
                    ? "border-brand bg-brand/10 font-medium text-brand"
                    : "border-line text-muted hover:border-brand/40 hover:text-ink"
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" />}
                {d.name}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-muted">
          Tickets for these teams can be assigned to them.
        </span>
      </div>
    </Modal>
  );
}
