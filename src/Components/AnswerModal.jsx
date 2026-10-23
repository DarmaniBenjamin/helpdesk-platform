import { useState } from "react";
import { Trash2, Sparkles, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import KeywordInput from "./KeywordInput";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { extractKeywords } from "./Knowledge";
import { DEPARTMENTS } from "../data";

// Create a new saved answer (no `answer` passed) or edit an existing one.
// onSave and onDelete save to the database; the form only closes once
// that worked, and shows the reason if it didn't.
//   draft:       a new answer filled in already (e.g. from a ticket's notes)
//   heading:     the box's title instead of "New saved answer"
//   intro:       a line at the top, saying why it's asking
//   cancelLabel: e.g. "Skip" instead of "Cancel"
export default function AnswerModal({
  answer,
  draft,
  heading,
  intro,
  cancelLabel = "Cancel",
  onSave,
  onDelete,
  onClose,
}) {
  const start = answer ?? draft;
  const [title, setTitle] = useState(start?.title ?? "");
  const [department, setDepartment] = useState(
    start?.department ?? DEPARTMENTS[0]?.id ?? "",
  );
  const [problem, setProblem] = useState(start?.problem ?? "");
  const [solution, setSolution] = useState(start?.solution ?? "");
  const [keywords, setKeywords] = useState(start?.keywords ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Deleting takes two clicks: "Delete", then "Yes, delete it"
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fill in keywords from what's been written so far
  function suggestKeywords() {
    const suggested = extractKeywords(
      `${title} ${title} ${problem} ${solution}`,
    );
    setKeywords([...new Set([...keywords, ...suggested])]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        title: title.trim(),
        department,
        problem: problem.trim(),
        solution: solution.trim(),
        // No keywords typed? Work them out automatically
        keywords: keywords.length
          ? keywords
          : extractKeywords(`${title} ${title} ${problem} ${solution}`),
      });
      document.activeElement?.blur();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={heading ?? (answer ? "Edit saved answer" : "New saved answer")}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        confirmDelete ? (
          // Second step of deleting: are you sure?
          <>
            <span className="mr-auto flex items-center gap-2 text-sm text-red-600">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Delete this answer for good?
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
              className="btn-glass btn-glass-red h-8.5 sm:h-7 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:flex-none"
            >
              {busy ? "Deleting…" : "Yes, delete it"}
            </button>
          </>
        ) : (
          <>
            {answer && (
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
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`${primaryButton} disabled:cursor-wait disabled:opacity-70`}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      {intro && <p className="text-sm text-muted">{intro}</p>}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <label className={labelClass}>
        Title
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Printer shows offline"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Team
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          {!DEPARTMENTS.some((d) => d.id === department) && (
            <option value={department}>No team</option>
          )}
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        The problem
        <textarea
          required
          rows={3}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="What was going wrong?"
          className={`${inputClass} h-auto shrink-0 py-2.5`}
        />
      </label>

      <label className={labelClass}>
        How it was fixed
        <textarea
          required
          rows={4}
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder={
            "What did you do to fix it? One step per line, e.g.\nRestarted the print spooler\nRe-added the printer by IP"
          }
          className={`${inputClass} h-auto shrink-0 py-2.5`}
        />
      </label>

      <div className={labelClass}>
        <div className="flex items-center justify-between gap-2">
          Keywords
          <button
            type="button"
            onClick={suggestKeywords}
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand transition hover:bg-brand/10 active:scale-[0.97]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Suggest from text
          </button>
        </div>
        <KeywordInput value={keywords} onChange={setKeywords} />
        <span className="text-xs font-normal text-muted">
          Leave empty and they'll be picked automatically.
        </span>
      </div>
    </Modal>
  );
}
