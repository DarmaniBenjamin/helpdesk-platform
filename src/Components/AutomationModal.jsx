import { useState } from "react";
import { Plus, Trash2, X, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import {
  TRIGGERS,
  ACTIONS,
  PARAM_OPTIONS,
  defaultParam,
} from "./automationOptions";

// The extra detail box for a trigger or action: a dropdown, a number, or text
function ParamInput({ param, value, onChange }) {
  if (!param) return null;

  if (param === "hours" || param === "days") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          required
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${inputClass} max-w-28`}
        />
        <span className="text-sm font-normal text-muted">{param}</span>
      </div>
    );
  }

  if (param === "text") {
    return (
      <input
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type the message or tag"
        className={inputClass}
      />
    );
  }

  const options = PARAM_OPTIONS[param];
  return (
    <select
      value={value}
      onChange={(e) => {
        // Priority values are numbers; dropdowns always give back text
        const picked = options.find((o) => String(o.value) === e.target.value);
        onChange(picked.value);
      }}
      className={`${inputClass} cursor-pointer`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Create a new automation (no `automation` passed) or edit an existing one.
// Saving and deleting go to the database; the form only closes once that
// worked, and shows the reason if it didn't.
export default function AutomationModal({
  automation,
  onSave,
  onDelete,
  onClose,
}) {
  const [name, setName] = useState(automation?.name ?? "");
  const [description, setDescription] = useState(automation?.description ?? "");
  const [trigger, setTrigger] = useState(
    automation?.trigger ?? { type: "created", value: null },
  );
  const [actions, setActions] = useState(
    automation?.actions ?? [{ type: "setStatus", value: "open" }],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // If saving to the database didn't work, the reason why
  const [saveError, setSaveError] = useState("");
  // Deleting takes two clicks: "Delete", then "Yes, delete it"
  const [confirmDelete, setConfirmDelete] = useState(false);

  function chooseTrigger(type) {
    setTrigger({ type, value: defaultParam(TRIGGERS[type].param) });
  }

  // Replace one action in the list with an updated copy
  function changeAction(index, changes) {
    setActions(actions.map((a, i) => (i === index ? { ...a, ...changes } : a)));
  }

  function chooseAction(index, type) {
    changeAction(index, { type, value: defaultParam(ACTIONS[type].param) });
  }

  function addAction() {
    setActions([...actions, { type: "notifyTeam", value: null }]);
    setError("");
  }

  function removeAction(index) {
    setActions(actions.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (actions.length === 0) {
      setError("Add at least one action.");
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        trigger,
        actions,
      });
      document.activeElement?.blur();
      onClose();
    } catch (err) {
      setSaveError(err.message);
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setSaveError("");
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setSaveError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={automation ? "Edit automation" : "New automation"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        confirmDelete ? (
          // Second step of deleting: are you sure?
          <>
            <span className="mr-auto flex items-center gap-2 text-sm text-red-600">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Delete this automation for good?
            </span>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className={secondaryButton}
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:flex-none"
            >
              {busy ? "Deleting…" : "Yes, delete it"}
            </button>
          </>
        ) : (
          <>
            {automation && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mr-auto flex h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-red-500 transition hover:bg-red-50 active:scale-[0.97]"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
            <button type="button" onClick={onClose} className={secondaryButton}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`${primaryButton} disabled:cursor-wait disabled:opacity-70`}
            >
              {busy ? "Saving…" : automation ? "Save" : "Create"}
            </button>
          </>
        )
      }
    >
      {saveError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {saveError}
        </p>
      )}

      <label className={labelClass}>
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Auto-close resolved tickets"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span>
          Description <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this automation do?"
          className={inputClass}
        />
      </label>

      {/* WHEN */}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-page/60 p-3">
        <p className="text-xs font-semibold tracking-wide text-brand">WHEN</p>
        <select
          value={trigger.type}
          onChange={(e) => chooseTrigger(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          {Object.entries(TRIGGERS).map(([type, { label, kind }]) => (
            <option key={type} value={type}>
              {label} ({kind})
            </option>
          ))}
        </select>
        <ParamInput
          param={TRIGGERS[trigger.type].param}
          value={trigger.value}
          onChange={(value) => setTrigger({ ...trigger, value })}
        />
      </div>

      {/* THEN */}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-page/60 p-3">
        <p className="text-xs font-semibold tracking-wide text-brand">THEN</p>
        {actions.map((action, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-lg border border-line bg-white p-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                {index + 1}
              </span>
              <select
                value={action.type}
                onChange={(e) => chooseAction(index, e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                {Object.entries(ACTIONS).map(([type, { label }]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeAction(index)}
                aria-label="Remove this action"
                className="shrink-0 cursor-pointer rounded-lg p-2 text-muted transition hover:bg-red-50 hover:text-red-500 active:scale-[0.92]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ParamInput
              param={ACTIONS[action.type].param}
              value={action.value}
              onChange={(value) => changeAction(index, { value })}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addAction}
          className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-brand/40 text-sm font-medium text-brand transition hover:bg-brand/5 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add another action
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
