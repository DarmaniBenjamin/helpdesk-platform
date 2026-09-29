import { useState } from "react";
import { Info } from "lucide-react";
import Modal from "./Modal";
import PriorityBadge from "./PriorityBadge";
import { inputClass, primaryButton, secondaryButton } from "./formStyles";
import { PRIORITIES } from "../data";

// Minutes, hours or days, each as a number of hours
const UNITS = [
  { id: "minutes", label: "minutes", hours: 1 / 60 },
  { id: "hours", label: "hours", hours: 1 },
  { id: "days", label: "days", hours: 24 },
];

// Picks the unit that reads best: 0.5 hours -> 30 minutes, 72 -> 3 days
function toField(hours) {
  if (hours >= 24 && hours % 24 === 0)
    return { amount: String(hours / 24), unit: "days" };
  if (hours < 1)
    return { amount: String(Math.round(hours * 60)), unit: "minutes" };
  return { amount: String(hours), unit: "hours" };
}

function toHours({ amount, unit }) {
  const n = Number(amount);
  const factor = UNITS.find((u) => u.id === unit).hours;
  return Number.isFinite(n) ? n * factor : NaN;
}

// A number and its unit, side by side
function DurationInput({ label, value, onChange }) {
  return (
    <div className="flex min-w-0 gap-2">
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        aria-label={`${label} (number)`}
        value={value.amount}
        onChange={(e) => onChange({ ...value, amount: e.target.value })}
        className={`${inputClass} w-20 shrink-0`}
      />
      <select
        aria-label={`${label} (unit)`}
        value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value })}
        className={`${inputClass} min-w-0 flex-1 cursor-pointer`}
      >
        {UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Changing the SLA targets (Admins and the Super Admin). `sla` is the
// current targets; `onSave` gets the new ones in hours, e.g.
// { 4: { firstResponse: 1, resolve: 4 }, ... }, and throws if the
// server says no.
export default function SlaTargetsModal({ sla, onSave, onClose }) {
  // Urgent first, like the table on the Performance page
  const priorities = Object.keys(PRIORITIES).map(Number).reverse();
  const [fields, setFields] = useState(() =>
    Object.fromEntries(
      priorities.map((p) => [
        p,
        {
          firstResponse: toField(sla[p].firstResponse),
          resolve: toField(sla[p].resolve),
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function change(p, key, value) {
    setFields((f) => ({ ...f, [p]: { ...f[p], [key]: value } }));
    setError("");
  }

  async function handleSave(e) {
    e.preventDefault();
    const next = {};
    for (const p of priorities) {
      const firstResponse = toHours(fields[p].firstResponse);
      const resolve = toHours(fields[p].resolve);
      const name = PRIORITIES[p].label;
      if (!(firstResponse > 0) || !(resolve > 0)) {
        setError(`${name}: fill in both times.`);
        return;
      }
      if (firstResponse > resolve) {
        setError(
          `${name}: the first reply can't be due after the ticket should be resolved.`,
        );
        return;
      }
      next[p] = { firstResponse, resolve };
    }
    setBusy(true);
    try {
      await onSave(next);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="SLA targets"
      onClose={onClose}
      onSubmit={handleSave}
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
            {busy ? "Saving…" : "Save targets"}
          </button>
        </>
      }
    >
      <p className="flex items-start gap-2 rounded-lg bg-page p-3 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        How fast each priority must get its first reply, and be resolved. New
        tickets get their due times from these. Tickets that already exist keep
        theirs.
      </p>

      <ul className="flex flex-col divide-y divide-line">
        {priorities.map((p) => (
          <li key={p} className="flex flex-col gap-3 py-3 first:pt-0">
            <PriorityBadge priority={p} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="text-muted">First reply within</span>
                <DurationInput
                  label={`${PRIORITIES[p].label}: first reply`}
                  value={fields[p].firstResponse}
                  onChange={(v) => change(p, "firstResponse", v)}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="text-muted">Resolve within</span>
                <DurationInput
                  label={`${PRIORITIES[p].label}: resolve`}
                  value={fields[p].resolve}
                  onChange={(v) => change(p, "resolve", v)}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </Modal>
  );
}
