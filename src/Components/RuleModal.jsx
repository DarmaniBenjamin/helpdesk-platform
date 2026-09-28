import { useState } from "react";
import { X, Trash2, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { DEPARTMENTS, AGENTS } from "../data";

// Create a new rule (no `rule` passed) or edit an existing one.
// Saving and deleting go to the database; the form only closes once that
// worked, and shows the reason if it didn't.
export default function RuleModal({ rule, onSave, onDelete, onClose }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [keywords, setKeywords] = useState(rule?.keywords ?? []);
  const [keywordText, setKeywordText] = useState("");
  const [department, setDepartment] = useState(
    rule?.department ?? DEPARTMENTS[0].id,
  );
  const [agent, setAgent] = useState(rule?.agent ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // If saving to the database didn't work, the reason why
  const [saveError, setSaveError] = useState("");
  // Deleting takes two clicks: "Delete", then "Yes, delete it"
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Only agents who work in the chosen department
  const teamAgents = AGENTS.filter((a) => a.departments.includes(department));

  function addKeyword() {
    const word = keywordText.trim().toLowerCase().replace(/,$/, "");
    if (word && !keywords.includes(word)) setKeywords([...keywords, word]);
    setKeywordText("");
    setError("");
  }

  function handleKeyDown(e) {
    // Enter or comma adds the word; Backspace on an empty box removes the last one
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword();
    } else if (e.key === "Backspace" && !keywordText && keywords.length) {
      setKeywords(keywords.slice(0, -1));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // A word still in the box counts too, even if Enter wasn't pressed
    const typed = keywordText.trim().toLowerCase();
    const allKeywords =
      typed && !keywords.includes(typed) ? [...keywords, typed] : keywords;
    if (allKeywords.length === 0) {
      setError("Add at least one keyword.");
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        keywords: allKeywords,
        department,
        agent: teamAgents.some((a) => a.id === agent) ? agent : null,
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
      title={rule ? "Edit rule" : "New rule"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        confirmDelete ? (
          // Second step of deleting: are you sure?
          <>
            <span className="mr-auto flex items-center gap-2 text-sm text-red-600">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Delete this rule for good?
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
            {rule && (
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
              {busy ? "Saving…" : rule ? "Save" : "Create rule"}
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
        Rule name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Billing questions"
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
          placeholder="What does this rule catch?"
          className={inputClass}
        />
      </label>

      <div className={labelClass}>
        When a ticket mentions any of these words
        {/* Keyword "chips" with the typing box inside the same border */}
        <div
          className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 ${
            error ? "border-red-400" : "border-line"
          }`}
        >
          {keywords.map((word) => (
            <span
              key={word}
              className="flex items-center gap-1 rounded-md bg-brand/10 py-1 pl-2 pr-1 text-sm font-normal text-brand"
            >
              {word}
              <button
                type="button"
                aria-label={`Remove ${word}`}
                onClick={() => setKeywords(keywords.filter((k) => k !== word))}
                className="cursor-pointer rounded p-0.5 hover:bg-brand/20"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <input
            value={keywordText}
            onChange={(e) => setKeywordText(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={addKeyword}
            enterKeyHint="done"
            placeholder={
              keywords.length
                ? "Add another..."
                : "Type a word, then press Enter"
            }
            className="min-w-32 flex-1 bg-transparent px-1 py-1 text-base font-normal placeholder:text-muted focus:outline-none sm:text-sm"
          />
        </div>
        <span className="text-xs font-normal text-muted">
          {error || "Checked against the ticket's subject and description."}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Assign to team
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          And agent
          <select
            value={agent ?? ""}
            onChange={(e) => setAgent(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Anyone on the team</option>
            {teamAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
