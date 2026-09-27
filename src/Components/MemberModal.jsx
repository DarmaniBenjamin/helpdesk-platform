import { useState } from "react";
import {
  CircleCheck,
  Check,
  Copy,
  Mail,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { ROLES, pickableRoles } from "./teamRoles";
import { copyText, inviteLinkFor } from "./copyText";
import useData from "../useData";

// Invite someone new (no `member` passed) or change an existing member's
// name, job title, access level and departments
export default function MemberModal({ member, onClose }) {
  const {
    me,
    team,
    departments: allDepartments,
    inviteMember,
    updateMember,
    findMemberByEmail,
    addDepartment,
    departmentNameTaken,
  } = useData();
  const editing = Boolean(member);

  const [email, setEmail] = useState(member?.email ?? "");
  const [name, setName] = useState(member?.name ?? "");
  const [title, setTitle] = useState(member?.title ?? "");
  const [role, setRole] = useState(member?.role ?? "agent");
  const [departments, setDepartments] = useState(member?.departments ?? []);
  const [error, setError] = useState("");
  // After inviting, show a "done" screen with their link instead of the form
  const [invited, setInvited] = useState(null); // { member, link }
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  // Typing a new department right here: null = not typing one
  const [newDepartment, setNewDepartment] = useState(null);
  const [departmentError, setDepartmentError] = useState("");

  // Job titles already used on the team, suggested as you type
  const knownTitles = [
    ...new Set(team.map((m) => m.title).filter(Boolean)),
  ].sort();

  async function createDepartment() {
    const clean = (newDepartment ?? "").trim();
    if (!clean) return;
    if (departmentNameTaken(clean)) {
      setDepartmentError("There's already a department with that name.");
      return;
    }
    try {
      const created = await addDepartment(clean);
      setDepartments((list) => [...list, created.id]); // and tick it
      setNewDepartment(null);
      setDepartmentError("");
    } catch (err) {
      setDepartmentError(err.message);
    }
  }

  function toggleDepartment(id) {
    setDepartments((list) =>
      list.includes(id) ? list.filter((d) => d !== id) : [...list, id],
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaveError("");

    // Nobody can be on the team twice (the server checks this too)
    if (!editing) {
      const existing = findMemberByEmail(email);
      if (existing) {
        setError(
          existing.status === "invited"
            ? "This person already has an invite waiting."
            : "This person is already on the team.",
        );
        return;
      }
    }

    setBusy(true);
    try {
      if (editing) {
        await updateMember(member.id, {
          name: name.trim(),
          title: title.trim(),
          role,
          departments,
        });
        document.activeElement?.blur();
        onClose();
        return;
      }
      const result = await inviteMember({
        email,
        name,
        title,
        role,
        departments,
      });
      document.activeElement?.blur();
      setInvited({ member: result.member, link: inviteLinkFor(result.token) });
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
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
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CircleCheck className="h-12 w-12 text-brand" />
          <p className="text-sm">
            <span className="font-semibold">{invited.member.email}</span> was
            invited as{" "}
            {/^[AEIOU]/.test(ROLES[invited.member.role].label) ? "an" : "a"}{" "}
            <span className="font-semibold">
              {ROLES[invited.member.role].label}
            </span>
            .
          </p>
          <p className="text-sm text-muted">
            Invite emails aren't set up yet, so send them this link yourself
            (WhatsApp, email, Teams...). It works once, for 7 days.
          </p>
        </div>

        {/* The invite link, with a copy button */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-page p-2">
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted">
            {invited.link}
          </span>
          <button
            type="button"
            onClick={async () => {
              if (await copyText(invited.link, "Copy this invite link:")) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <p className="text-center text-xs text-muted">
          They show as "Invited" on the Team page until they set up their
          account. You can get a new link there any time.
        </p>
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
          <button
            type="submit"
            disabled={busy}
            className={`${primaryButton} disabled:cursor-wait disabled:opacity-70`}
          >
            {busy ? "Saving…" : editing ? "Save" : "Create invite"}
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

      <label className={labelClass}>
        <span>
          Job title <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          list="job-titles"
          placeholder="e.g. IT Support Technician"
          className={inputClass}
        />
        {/* Titles already on the team pop up as suggestions */}
        <datalist id="job-titles">
          {knownTitles.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <span className="text-xs font-normal text-muted">
          Shows next to their name. Type anything.
        </span>
      </label>

      {/* Access level: what they can do in the app. Only the Super Admin
          can make someone an Admin. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Access level</legend>
        {pickableRoles(me.role).map((id) => {
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

      {/* Departments: tap to switch each one on or off */}
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Departments</p>
        <div className="flex flex-wrap gap-2">
          {allDepartments.map((d) => {
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

          {/* Make a new department without leaving this form */}
          {newDepartment === null ? (
            <button
              type="button"
              onClick={() => setNewDepartment("")}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-sm text-muted transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
            >
              <Plus className="h-3.5 w-3.5" />
              New department
            </button>
          ) : (
            <div className="flex w-full items-center gap-2">
              <input
                autoFocus
                value={newDepartment}
                onChange={(e) => {
                  setNewDepartment(e.target.value);
                  setDepartmentError("");
                }}
                onKeyDown={(e) => {
                  // Enter adds it (instead of sending the whole form)
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createDepartment();
                  }
                  if (e.key === "Escape") setNewDepartment(null);
                }}
                placeholder="e.g. Night Shift"
                className={`${inputClass} h-9 min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={createDepartment}
                disabled={!newDepartment.trim()}
                className="h-9 shrink-0 cursor-pointer rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => {
                  setNewDepartment(null);
                  setDepartmentError("");
                }}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-page hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {departmentError ? (
          <span className="text-xs text-red-500">{departmentError}</span>
        ) : (
          <span className="text-xs text-muted">
            Tickets for these departments can be assigned to them.
          </span>
        )}
      </div>

      {saveError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {saveError}
        </p>
      )}
    </Modal>
  );
}
