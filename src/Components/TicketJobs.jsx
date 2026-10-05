import { useEffect, useState } from "react";
import { CalendarDays, CalendarPlus, Check } from "lucide-react";
import JobModal from "./JobModal";
import { JOB_KINDS } from "./jobKinds";
import { api } from "../api";
import useData from "../useData";

const fmt = (ms, options) => new Date(ms).toLocaleString("en-US", options);
const timeLabel = (ms) =>
  fmt(ms, { hour: "numeric", minute: "2-digit" }).replace(":00", "");

// On the ticket page: the ticket's jobs on the calendar, and booking one
// for it (Calendar.jsx shows them all)
export default function TicketJobs({ ticket }) {
  const { team, jobsVersion } = useData();
  const [jobs, setJobs] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api(`/jobs?ticketId=${ticket.id}`)
      .then((list) => !cancelled && setJobs(list))
      .catch(() => !cancelled && setJobs([]));
    return () => {
      cancelled = true;
    };
  }, [ticket.id, jobsVersion]);

  const nameOf = (id) => {
    const m = team.find((t) => t.id === id);
    return m?.name || m?.email || "Someone";
  };

  function book() {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    setEditing({
      start: start.getTime(),
      end: start.getTime() + 60 * 60 * 1000,
      title: ticket.subject,
      ticketId: ticket.id,
      ticketSubject: ticket.subject,
      customerId: ticket.requester?.id,
      customerName: ticket.requester?.name,
      agents: ticket.assignee ? [ticket.assignee] : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {jobs?.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {jobs.map((j) => {
            const Icon = JOB_KINDS[j.kind]?.icon ?? CalendarDays;
            return (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => setEditing(j)}
                  className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border border-line p-2 text-left text-sm transition hover:border-brand/30 ${j.done ? "opacity-60" : ""}`}
                >
                  {j.done ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  ) : (
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {fmt(j.start, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      , {timeLabel(j.start)}–{timeLabel(j.end)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {j.agents.map(nameOf).join(", ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={book}
        className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line text-sm transition hover:border-brand/40 hover:text-brand"
      >
        <CalendarPlus className="h-4 w-4" />
        Schedule a job
      </button>
      {editing && (
        <JobModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={(job) => {
            setJobs((list) => [
              ...(list ?? []).filter((x) => x.id !== job.id),
              job,
            ]);
            setEditing(null);
          }}
          onDeleted={(id) => {
            setJobs((list) => list.filter((x) => x.id !== id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
