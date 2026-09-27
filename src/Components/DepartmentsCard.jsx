import { useState } from "react";
import { Check, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import Card from "./Card";
import Modal from "./Modal";
import { inputClass, secondaryButton } from "./formStyles";
import { isDone } from "../data";
import useData from "../useData";

// A small square icon button, like the ones on the team list
function IconAction({ label, onClick, danger, disabled, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "hover:bg-red-50 hover:text-red-500"
          : "hover:bg-brand/10 hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}

// A text box with Save and Cancel, for adding or renaming a department
function NameEditor({ initial = "", exceptId, onSave, onCancel }) {
  const { departmentNameTaken } = useData();
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const clean = name.trim();
    if (!clean || busy) return;
    if (departmentNameTaken(clean, exceptId)) {
      setError("There's already a department with that name.");
      return;
    }
    setBusy(true);
    try {
      await onSave(clean); // saves to the database
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Department name"
          className={`${inputClass} h-10 min-w-0 flex-1`}
        />
        <IconAction label="Save" onClick={save} disabled={!name.trim() || busy}>
          <Check className="h-4 w-4" />
        </IconAction>
        <IconAction label="Cancel" onClick={onCancel}>
          <X className="h-4 w-4" />
        </IconAction>
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

// "Are you sure?" before deleting, showing exactly what happens
function DeleteModal({ department, counts, onConfirm, onClose }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = [
    counts.tickets > 0 &&
      `${counts.tickets} ticket${counts.tickets === 1 ? "" : "s"} will go back to "No team yet".`,
    counts.people > 0 &&
      `${counts.people} ${counts.people === 1 ? "person" : "people"} will be taken off it.`,
    counts.rules > 0 &&
      `${counts.rules} assignment rule${counts.rules === 1 ? "" : "s"} for it will be switched off.`,
  ].filter(Boolean);

  return (
    <Modal
      title={`Delete ${department.name}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Keep
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(); // deletes it from the database
                onClose();
              } catch (err) {
                setError(err.message);
                setBusy(false);
              }
            }}
            className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:flex-none"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </>
      }
    >
      {lines.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing uses it yet.</p>
      )}
      <p className="text-sm text-muted">
        Tickets and Knowledge Base answers aren't deleted.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
}

// The departments (groups) on the Team page: add your own, rename them,
// and delete ones you don't need. They show up everywhere a department
// can be picked: tickets, invites, rules, the Inbox filters and reports.
export default function DepartmentsCard() {
  const {
    departments,
    team,
    tickets,
    rules,
    addDepartment,
    renameDepartment,
    deleteDepartment,
  } = useData();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // How much uses each department
  function countsFor(id) {
    return {
      people: team.filter((m) => m.departments.includes(id)).length,
      tickets: tickets.filter((t) => t.department === id && !isDone(t)).length,
      rules: rules.filter((r) => r.department === id && r.enabled).length,
    };
  }

  const onlyOne = departments.length <= 1;

  return (
    <Card
      title="Departments"
      action={
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
          }}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add department</span>
          <span className="sm:hidden">Add</span>
        </button>
      }
    >
      <p className="-mt-2 mb-4 text-sm text-muted">
        Your own groups, like Managed Services or Support. People can be in more
        than one.
      </p>

      <ul className="-mx-5 divide-y divide-line border-t border-line">
        {adding && (
          <li className="px-5 py-3">
            <NameEditor
              onSave={async (name) => {
                await addDepartment(name);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </li>
        )}

        {departments.map((d) => {
          const counts = countsFor(d.id);
          return (
            <li key={d.id} className="px-5 py-3 transition hover:bg-brand/5">
              {editingId === d.id ? (
                <NameEditor
                  initial={d.name}
                  exceptId={d.id}
                  onSave={async (name) => {
                    await renameDepartment(d.id, name);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <Layers className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.name}</p>
                    <p className="text-xs text-muted">
                      {counts.people}{" "}
                      {counts.people === 1 ? "person" : "people"} ·{" "}
                      {counts.tickets} open ticket
                      {counts.tickets === 1 ? "" : "s"}
                    </p>
                  </div>
                  <IconAction
                    label="Rename"
                    onClick={() => {
                      setEditingId(d.id);
                      setAdding(false);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </IconAction>
                  <IconAction
                    label={onlyOne ? "You need at least one" : "Delete"}
                    onClick={() => setDeleting(d)}
                    disabled={onlyOne}
                    danger
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconAction>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {deleting && (
        <DeleteModal
          department={deleting}
          counts={countsFor(deleting.id)}
          onConfirm={() => deleteDepartment(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}
