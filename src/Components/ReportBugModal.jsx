import { useState } from "react";
import { useLocation } from "react-router";
import { CircleCheck } from "lucide-react";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { api } from "../api";

// "Report a bug" (the profile menu in the top bar): any member of staff
// can report something that isn't working. It becomes an incident on the
// Maintenance page (server/src/incidents.js), with the page they were on.
export default function ReportBugModal({ onClose }) {
  const location = useLocation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentId, setSentId] = useState(null);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api("/incidents/report", {
        method: "POST",
        body: { title, description, page: location.pathname },
      });
      setSentId(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sentId)
    return (
      <Modal
        title="Bug reported"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose} className={primaryButton}>
            Done
          </button>
        }
      >
        <div className="flex items-start gap-3 text-sm">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <p>
            Thanks. It's on the Maintenance page as incident #{sentId}, with the
            page you were on.
          </p>
        </div>
      </Modal>
    );

  return (
    <Modal
      title="Report a bug"
      onClose={onClose}
      onSubmit={send}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`${primaryButton} disabled:opacity-60`}
          >
            {busy ? "Sending…" : "Send report"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Something not working? Describe it here. The page you're on is added
          automatically. Don't include passwords or customers' private details.
        </p>
        <label className={labelClass}>
          <span>What went wrong?</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            placeholder="e.g. Saving a ticket's priority does nothing"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>What happened, and what did you expect?</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            required
            rows={5}
            placeholder="What you clicked, what you saw (any error message), and what should have happened"
            className={`${inputClass} h-auto shrink-0 py-2.5`}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
