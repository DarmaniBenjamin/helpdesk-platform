import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Inbox as InboxIcon,
} from "lucide-react";
import StatusBadge from "../StatusBadge";
import NewTicketModal from "../NewTicketModal";
import useData from "../../useData";
import { STATUSES, timeAgo } from "../../data";

const PAGE_SIZE = 15;

// Status order used when sorting by status
const STATUS_ORDER = Object.keys(STATUSES); // open, pending, waiting, resolved, closed

const SORTS = {
  newest: {
    label: "Sort by date: newest",
    compare: (a, b) => b.createdAt - a.createdAt,
  },
  oldest: {
    label: "Sort by date: oldest",
    compare: (a, b) => a.createdAt - b.createdAt,
  },
  updated: {
    label: "Recently updated",
    compare: (a, b) => b.updatedAt - a.updatedAt,
  },
  status: {
    label: "Sort by status",
    compare: (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      b.createdAt - a.createdAt,
  },
};

// Same padding and bottom line for every table cell
const cell = "border-b border-line px-4 py-3.5 group-last:border-0";

export default function TicketTopics() {
  const navigate = useNavigate();
  const { tickets } = useData();
  const listRef = useRef(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  // How many tickets have each status, for the summary chips
  const counts = { all: tickets.length };
  for (const id of STATUS_ORDER)
    counts[id] = tickets.filter((t) => t.status === id).length;

  const results = tickets
    .filter((t) => statusFilter === "all" || t.status === statusFilter)
    .sort(SORTS[sort].compare);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const shown = results.slice(start, start + PAGE_SIZE);

  function goToPage(number) {
    setPage(number);
    // Bring the top of the list back into view
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function chooseFilter(id) {
    setStatusFilter(id);
    setPage(1);
  }

  const openTicket = (t) => navigate(`/tickets/${t.id}`);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Requests</h1>
          <p className="mt-1 text-sm text-muted">
            Every ticket, open and closed, in one place
          </p>
        </div>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          className="h-10 w-full cursor-pointer rounded-lg border border-line bg-white px-3 text-base text-muted focus:border-brand focus:outline-none sm:w-auto sm:text-sm"
        >
          {Object.entries(SORTS).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Overview: how many tickets in each status. Tap one to show only those. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { id: "all", label: "All tickets" },
          ...STATUS_ORDER.map((id) => ({ id, label: STATUSES[id].label })),
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => chooseFilter(s.id)}
            className={`cursor-pointer rounded-xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] ${
              statusFilter === s.id
                ? "border-brand ring-2 ring-brand/20"
                : "border-line"
            }`}
          >
            <p className="truncate text-sm text-muted">{s.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold ${statusFilter === s.id ? "text-brand" : ""}`}
            >
              {counts[s.id]}
            </p>
          </button>
        ))}
      </div>

      {/* The list */}
      <div
        ref={listRef}
        className="scroll-mt-20 rounded-xl border border-line bg-white p-4 sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {statusFilter === "all"
              ? "Latest Tickets"
              : STATUSES[statusFilter].label}
          </h2>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
          >
            Create Ticket
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <InboxIcon className="h-8 w-8 text-muted" />
            <p className="text-sm text-muted">No tickets with this status.</p>
          </div>
        ) : (
          <>
            {/* Tablets and up: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-200 border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="whitespace-nowrap bg-brand/10 text-brand">
                    <th className="rounded-l-lg px-4 py-3 font-medium">
                      Ticket ID
                    </th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="rounded-r-lg px-4 py-3 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className="group cursor-pointer transition hover:bg-brand/5 active:bg-brand/10"
                    >
                      <td
                        className={`${cell} font-medium transition group-hover:text-brand`}
                      >
                        #{t.id}
                      </td>
                      <td className={`${cell} whitespace-nowrap`}>
                        {t.requester.name}
                      </td>
                      <td className={`${cell} text-muted`}>
                        <span
                          className="block max-w-56 truncate"
                          title={t.requester.email}
                        >
                          {t.requester.email}
                        </span>
                      </td>
                      <td
                        className={`${cell} min-w-48 transition group-hover:text-brand`}
                      >
                        {t.subject}
                      </td>
                      <td className={`${cell} whitespace-nowrap text-muted`}>
                        {timeAgo(t.createdAt)}
                      </td>
                      <td className={cell}>
                        <StatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phones: cards */}
            <ul className="flex flex-col divide-y divide-line md:hidden">
              {shown.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openTicket(t)}
                    className="group -mx-2 flex w-[calc(100%+1rem)] cursor-pointer flex-col gap-1.5 rounded-lg px-2 py-3 text-left transition hover:bg-brand/5 active:bg-brand/10"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="font-medium">#{t.id}</span>
                      <span>{timeAgo(t.createdAt)}</span>
                    </div>
                    <p className="font-medium transition group-hover:text-brand">
                      {t.subject}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-muted">
                        {t.requester.name}
                      </span>
                      <StatusBadge status={t.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* Pages */}
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-line pt-4 text-sm sm:flex-row">
              <p className="text-muted">
                Showing {start + 1}–
                {Math.min(start + PAGE_SIZE, results.length)} of{" "}
                {results.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line transition hover:border-brand/40 hover:text-brand active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-20 text-center text-muted">
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  aria-label="Next page"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line transition hover:border-brand/40 hover:text-brand active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {creating && <NewTicketModal onClose={() => setCreating(false)} />}
    </div>
  );
}
