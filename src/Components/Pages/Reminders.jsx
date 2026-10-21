import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CalendarClock,
  ChevronDown,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import Modal from "../Modal";
import Avatar from "../Avatar";
import Droplets from "../Droplets";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "../formStyles";
import { can } from "../teamRoles";
import { api } from "../../api";
import useData from "../../useData";

// Reminders (server/src/reminders.js): everyone on the team sees them;
// Admins and the Super Admin make, change and delete them. When one is
// due, the people it's for get a notification (bell + phone/computer).

const REPEATS = {
  none: "Once",
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};

const pad = (n) => String(n).padStart(2, "0");
const dateValue = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeValue = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// "Today 9:00 AM", "Tomorrow 2:30 PM", "Fri, Oct 23, 9:00 AM"
function whenText(time) {
  const d = new Date(time);
  const clock = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `Today ${clock}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${clock}`;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

function ReminderModal({ reminder, staff, onSaved, onClose }) {
  const isNew = !reminder;
  // A new one: the next whole hour
  const start =
    reminder?.remindAt ??
    (() => {
      const d = new Date();
      d.setHours(d.getHours() + 1, 0, 0, 0);
      return d.getTime();
    })();
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [notes, setNotes] = useState(reminder?.notes ?? "");
  const [date, setDate] = useState(dateValue(start));
  const [time, setTime] = useState(timeValue(start));
  const [repeat, setRepeat] = useState(reminder?.repeat ?? "none");
  const [everyone, setEveryone] = useState(reminder?.everyone ?? true);
  const [people, setPeople] = useState(reminder?.userIds ?? []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openedAt] = useState(() => Date.now()); // for "that time has passed"

  const remindAt = new Date(`${date}T${time}`);
  const inPast =
    !Number.isNaN(remindAt.getTime()) && remindAt.getTime() < openedAt;
  const ready =
    title.trim() && date && time && (everyone || people.length > 0) && !busy;

  async function save(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy("save");
    setError("");
    try {
      const body = {
        title: title.trim(),
        notes: notes.trim(),
        remindAt: remindAt.getTime(),
        repeat,
        everyone,
        userIds: everyone ? [] : people,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      await api(isNew ? "/reminders" : `/reminders/${reminder.id}`, {
        method: isNew ? "POST" : "PATCH",
        body,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function remove() {
    setBusy("delete");
    setError("");
    try {
      await api(`/reminders/${reminder.id}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  return (
    <Modal
      title={isNew ? "New reminder" : "Edit reminder"}
      onClose={onClose}
      onSubmit={save}
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto flex items-center gap-2 text-sm text-red-600">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Delete this reminder?
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
              onClick={remove}
              disabled={Boolean(busy)}
              className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:opacity-70 sm:flex-none"
            >
              {busy === "delete" ? "Deleting…" : "Yes, delete it"}
            </button>
          </>
        ) : (
          <>
            {!isNew && (
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
              disabled={!ready}
              className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
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
        What to remind
        <input
          autoFocus
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Renew the domain for Spice Isle Dental"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Notes
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything that helps (optional)"
          className={`${inputClass} h-auto shrink-0 py-2.5`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Day
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          />
        </label>
        <label className={labelClass}>
          Time
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          />
        </label>
      </div>
      {inPast && (
        <p className="text-xs text-amber-700">
          That time has passed:{" "}
          {repeat === "none"
            ? "it goes off straight away."
            : "it goes off now, then moves on to its next time."}
        </p>
      )}
      <label className={labelClass}>
        Repeat
        <select
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          {Object.entries(REPEATS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Who gets the notification</span>
        <div className="flex gap-2">
          {[
            [true, "Everyone"],
            [false, "Only some people"],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setEveryone(value)}
              className={`h-9 cursor-pointer rounded-full border px-4 text-sm transition active:scale-[0.97] ${
                everyone === value
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {!everyone && (
          <>
            <div className="flex flex-wrap gap-2">
              {staff.map((m) => {
                const on = people.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setPeople((list) =>
                        on ? list.filter((id) => id !== m.id) : [...list, m.id],
                      )
                    }
                    className={`flex cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition active:scale-[0.97] ${
                      on
                        ? "border-brand bg-brand/10 font-medium text-brand"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    <span className="scale-75">
                      <Avatar
                        name={m.name || m.email}
                        photo={m.photo}
                        size="sm"
                      />
                    </span>
                    {m.name || m.email}
                  </button>
                );
              })}
            </div>
            {people.length === 0 && (
              <p className="text-xs text-red-500">Pick at least one.</p>
            )}
          </>
        )}
        <p className="text-xs text-muted">
          Everyone on the team can see this reminder on this page.
        </p>
      </div>
    </Modal>
  );
}

function ReminderCard({ reminder, names, canEdit, onEdit, now }) {
  const overdue = !reminder.done && reminder.remindAt < now;
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-white p-4">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          reminder.done ? "bg-line text-muted" : "bg-brand/10 text-brand"
        }`}
      >
        <BellRing className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${reminder.done ? "text-muted" : ""}`}>
          {reminder.title}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span
            className={`flex items-center gap-1 ${overdue ? "text-amber-700" : ""}`}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            {reminder.done
              ? `Went off ${whenText(reminder.sentAt)}`
              : whenText(reminder.remindAt)}
          </span>
          {reminder.repeat !== "none" && (
            <span className="flex items-center gap-1">
              <Repeat className="h-3.5 w-3.5" />
              {REPEATS[reminder.repeat]}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {reminder.everyone
              ? "Everyone"
              : reminder.userIds.map((id) => names[id] ?? "Someone").join(", ")}
          </span>
        </p>
        {reminder.notes && (
          <p className="mt-2 whitespace-pre-wrap text-sm">{reminder.notes}</p>
        )}
        {reminder.createdBy && (
          <p className="mt-2 text-xs text-muted">
            Made by {reminder.createdBy}
          </p>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${reminder.title}`}
          title="Edit"
          className="shrink-0 cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92]"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

export default function Reminders() {
  const { me, team, remindersVersion } = useData();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // a reminder, or "new"
  const [showDone, setShowDone] = useState(false);
  const [reload, setReload] = useState(0);
  // When the list was loaded (to show ones that are late in amber)
  const [now, setNow] = useState(() => Date.now());
  const canEdit = can(me.role, "reminders");

  // Loaded when the page opens, and again when anyone changes one (or
  // one goes off)
  useEffect(() => {
    let current = true;
    api("/reminders")
      .then((rows) => {
        if (!current) return;
        setList(rows);
        setError("");
        setNow(Date.now());
      })
      .catch((err) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [remindersVersion, reload]);

  const staff = useMemo(
    () =>
      team
        .filter((m) => m.role !== "customer" && m.status === "active")
        .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    [team],
  );
  const names = Object.fromEntries(team.map((m) => [m.id, m.name || m.email]));
  const upcoming = (list ?? []).filter((r) => !r.done);
  const done = (list ?? [])
    .filter((r) => r.done)
    .sort((a, b) => b.sentAt - a.sentAt);
  const mine = (r) => r.everyone || r.userIds.includes(me.id);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Reminders</h1>
          <p className="mt-1 text-sm text-muted">
            {canEdit
              ? "Everyone on the team sees these. The people each one is for get a notification when it's due."
              : "Made by your Admins. You get a notification when one for you is due."}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className={`${primaryButton} flex items-center justify-center gap-2`}
          >
            <Plus className="h-4 w-4" />
            New reminder
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {!list && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" /> Loading…
        </p>
      )}

      {list && upcoming.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-white p-8 text-center">
          <BellRing className="h-8 w-8 text-muted" />
          <p className="font-medium">No reminders coming up</p>
          <p className="text-sm text-muted">
            {canEdit
              ? "Add one for anything the team mustn't forget: renewals, monthly checks, follow-ups."
              : "When your Admins add one, it shows here."}
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <ul className="flex flex-col gap-3">
          {upcoming.map((r) => (
            <ReminderCard
              key={r.id}
              reminder={r}
              names={names}
              canEdit={canEdit}
              now={now}
              onEdit={() => setEditing(r)}
            />
          ))}
        </ul>
      )}
      {list && !canEdit && upcoming.length > 0 && !upcoming.some(mine) && (
        <p className="text-xs text-muted">None of these are for you.</p>
      )}

      {done.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink"
          >
            <ChevronDown
              className={`h-4 w-4 transition ${showDone ? "rotate-180" : ""}`}
            />
            Done ({done.length})
          </button>
          {showDone && (
            <ul className="flex flex-col gap-3">
              {done.map((r) => (
                <ReminderCard
                  key={r.id}
                  reminder={r}
                  names={names}
                  canEdit={canEdit}
                  now={now}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <ReminderModal
          reminder={editing === "new" ? null : editing}
          staff={staff}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
