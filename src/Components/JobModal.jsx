import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CircleCheck, Trash2, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import Avatar from "./Avatar";
import Droplets from "./Droplets";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { JOB_KINDS } from "./jobKinds";
import { api } from "../api";
import useData from "../useData";

// "2026-10-05" and "14:30" for date and time boxes, in this computer's time
const pad = (n) => String(n).padStart(2, "0");
const dateValue = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeValue = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toMs = (date, time) => new Date(`${date}T${time}`).getTime();

// Book a new job, or change one. For a new one, `job` holds what's known
// already: { start, end, agents, title, ticketId, ticketSubject,
// customerId, customerName }. onSaved(job) / onDeleted(id) afterwards.
export default function JobModal({ job, onClose, onSaved, onDeleted }) {
  const { team, customers, me } = useData();
  const isNew = !job.id;
  const staff = useMemo(
    () =>
      team
        .filter((m) => m.role !== "customer" && m.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [team],
  );

  const [title, setTitle] = useState(job.title ?? "");
  const [kind, setKind] = useState(job.kind ?? "onsite");
  const [date, setDate] = useState(dateValue(job.start));
  const [from, setFrom] = useState(timeValue(job.start));
  const [to, setTo] = useState(timeValue(job.end));
  // A job over several days keeps its own end day
  const endDay = dateValue(job.end);
  const [agents, setAgents] = useState(
    job.agents?.length ? job.agents : [me.id],
  );
  const [location, setLocation] = useState(job.location ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");
  const [customer, setCustomer] = useState(
    job.customerId ? { id: job.customerId, name: job.customerName } : null,
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const matches = search.trim()
    ? customers
        .filter((c) =>
          `${c.name} ${c.company ?? ""} ${c.email ?? ""}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];

  const start = toMs(date, from);
  const sameDay = isNew || endDay === dateValue(job.start);
  let end = toMs(sameDay ? date : endDay, to);
  // Ends "before" it starts on the same day, e.g. 22:00 to 01:00: next day
  if (sameDay && end <= start) end += 24 * 60 * 60 * 1000;

  const toggleAgent = (id) =>
    setAgents((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );

  async function save(e) {
    e.preventDefault();
    if (!title.trim() || !agents.length || busy) return;
    setBusy("save");
    setError("");
    const body = {
      title,
      kind,
      start,
      end,
      agents,
      location,
      notes,
      customerId: customer?.id ?? null,
    };
    try {
      const saved = isNew
        ? await api("/jobs", {
            method: "POST",
            body: { ...body, ticketId: job.ticketId ?? null },
          })
        : await api(`/jobs/${job.id}`, { method: "PATCH", body });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function setDone(done) {
    setBusy("done");
    setError("");
    try {
      onSaved(
        await api(`/jobs/${job.id}`, { method: "PATCH", body: { done } }),
      );
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function remove() {
    setBusy("delete");
    setError("");
    try {
      await api(`/jobs/${job.id}`, { method: "DELETE" });
      onDeleted(job.id);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  return (
    <Modal
      title={isNew ? "Book a job" : "Job"}
      onClose={busy ? () => {} : onClose}
      onSubmit={save}
      footer={
        confirmDelete ? (
          <>
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
              className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-60 sm:flex-none"
            >
              {busy === "delete" && <Droplets className="h-4 w-4" />}
              Remove job
            </button>
          </>
        ) : (
          <>
            {!isNew && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Remove job"
                title="Remove job"
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-red-500 transition hover:bg-red-50 sm:mr-auto"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            {!isNew && (
              <button
                type="button"
                onClick={() => setDone(!job.done)}
                disabled={Boolean(busy)}
                className={`${secondaryButton} flex items-center justify-center gap-2`}
              >
                {busy === "done" ? (
                  <Droplets className="h-4 w-4" />
                ) : (
                  <CircleCheck className="h-4 w-4" />
                )}
                {job.done ? "Not done" : "Done"}
              </button>
            )}
            <button
              type="submit"
              disabled={!title.trim() || !agents.length || Boolean(busy)}
              className={`${primaryButton} flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busy === "save" && <Droplets className="h-4 w-4" />}
              {isNew ? "Book job" : "Save"}
            </button>
          </>
        )
      }
    >
      {confirmDelete ? (
        <p className="text-sm">
          Remove <strong>{job.title}</strong> from the calendar? The agents on
          it are told it's cancelled.
        </p>
      ) : (
        <>
          {job.ticketId && (
            <p className="rounded-lg bg-page px-3 py-2 text-sm">
              For ticket{" "}
              <Link
                to={`/tickets/${job.ticketId}`}
                onClick={onClose}
                className="font-medium text-brand hover:underline"
              >
                #{job.ticketId}
              </Link>
              {job.ticketSubject ? `: ${job.ticketSubject}` : ""}
            </p>
          )}

          <label className={labelClass}>
            What
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fix the office printer"
              className={inputClass}
            />
          </label>

          {/* The kind of job */}
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(JOB_KINDS).map(([id, k]) => {
              const Icon = k.icon;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setKind(id)}
                  className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm transition active:scale-[0.97] ${
                    kind === id
                      ? "border-brand bg-brand/10 font-medium text-brand"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {k.label}
                </button>
              );
            })}
          </div>

          {/* When */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <label className={labelClass}>
              Day
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              From
              <input
                type="time"
                required
                step="900"
                value={from}
                onChange={(e) => {
                  // Moving the start moves the end with it
                  const length = end - start;
                  setFrom(e.target.value);
                  const newStart = toMs(date, e.target.value);
                  if (!Number.isNaN(newStart))
                    setTo(timeValue(newStart + length));
                }}
                className={`${inputClass} w-28`}
              />
            </label>
            <label className={labelClass}>
              To
              <input
                type="time"
                required
                step="900"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`${inputClass} w-28`}
              />
            </label>
          </div>
          {!sameDay && (
            <p className="text-xs text-muted">
              Ends on{" "}
              {new Date(end).toLocaleDateString("en-US", {
                dateStyle: "medium",
              })}
              .
            </p>
          )}

          {/* Who */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Who</span>
            <div className="flex flex-wrap gap-2">
              {staff.map((m) => {
                const on = agents.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleAgent(m.id)}
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
            {!agents.length && (
              <p className="text-xs text-red-500">Pick at least one.</p>
            )}
          </div>

          {/* Customer (filled in from the ticket when there is one) */}
          {!job.ticketId && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Customer{" "}
                <span className="font-normal text-muted">(optional)</span>
              </span>
              {customer ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="truncate">{customer.name}</span>
                  <button
                    type="button"
                    onClick={() => setCustomer(null)}
                    className="cursor-pointer text-xs text-muted underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search customers…"
                    className={inputClass}
                  />
                  {matches.length > 0 && (
                    <ul className="absolute inset-x-0 top-12 z-10 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
                      {matches.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomer({ id: c.id, name: c.name });
                              setSearch("");
                            }}
                            className="flex w-full cursor-pointer flex-col px-3 py-2 text-left text-sm hover:bg-page"
                          >
                            <span>{c.name}</span>
                            {c.company && (
                              <span className="text-xs text-muted">
                                {c.company}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {kind === "onsite" && (
            <label className={labelClass}>
              <span>
                Where <span className="font-normal text-muted">(optional)</span>
              </span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Grand Anse, upstairs office"
                className={inputClass}
              />
            </label>
          )}

          <label className={labelClass}>
            <span>
              Notes <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What to bring, who to ask for…"
              className={`${inputClass} h-auto resize-y py-2.5`}
            />
          </label>

          {error && (
            <p className="flex items-start gap-2 text-sm text-red-500">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
