import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Search, SlidersHorizontal, X, Inbox as InboxIcon } from "lucide-react";
import StatusBadge from "../StatusBadge";
import PriorityBadge from "../PriorityBadge";
import DueLabel from "../DueLabel";
import Avatar from "../Avatar";
import { inputClass } from "../formStyles";
import Pagination from "../Pagination";
import { pageCount, pageOf, usePaging } from "../paging";
import useData from "../../useData";
import {
  STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  AGENTS,
  isDone,
  isOverdue,
  timeAgo,
  findDepartment,
  findAgent,
} from "../../data";

// The tabs across the top. "active" means anything not resolved/closed.
// "unassigned" is the queue of new work nobody has picked up yet, like
// requests from the customer portal. The admin assigns them, or a tech
// takes one themselves.
const TABS = [
  { id: "active", label: "Active" },
  { id: "unassigned", label: "Unassigned" },
  ...Object.entries(STATUSES).map(([id, { label }]) => ({ id, label })),
  { id: "all", label: "All" },
];

const SORTS = {
  newest: {
    label: "Newest first",
    compare: (a, b) => b.createdAt - a.createdAt,
  },
  oldest: {
    label: "Oldest first",
    compare: (a, b) => a.createdAt - b.createdAt,
  },
  due: {
    label: "Due soonest",
    // Finished tickets go last; the rest by due time
    compare: (a, b) => isDone(a) - isDone(b) || a.dueBy - b.dueBy,
  },
  priority: {
    label: "Highest priority",
    compare: (a, b) => b.priority - a.priority || a.dueBy - b.dueBy,
  },
};

function matchesTab(ticket, tab) {
  if (tab === "all") return true;
  if (tab === "active") return !isDone(ticket);
  if (tab === "unassigned") return !isDone(ticket) && !ticket.assignee;
  return ticket.status === tab;
}

// Does the ticket match the search text? Checks number, subject,
// customer and tags.
function matchesSearch(ticket, text) {
  if (!text) return true;
  const { requester } = ticket;
  return [
    `#${ticket.id}`,
    ticket.subject,
    requester.name,
    requester.email ?? "",
    requester.company ?? "",
    ...(ticket.tags ?? []),
  ].some((field) => field.toLowerCase().includes(text));
}

function AssigneeLabel({ id }) {
  const agent = findAgent(id);
  if (!agent) return <span className="text-sm text-muted">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
      <Avatar name={agent.name} size="sm" />
      {agent.name.split(" ")[0]}
    </span>
  );
}

export default function Inbox() {
  const navigate = useNavigate();
  const { tickets } = useData();

  // The search lives in the URL (?search=...), so the top bar search can send you here
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";

  const [tab, setTab] = useState("active");
  const [priority, setPriority] = useState("any");
  const [department, setDepartment] = useState("any");
  const [assignee, setAssignee] = useState("any");
  const [sort, setSort] = useState("newest");
  const [showFilters, setShowFilters] = useState(false); // phones only
  // Which page, and how many per page (30, 50 or 100)
  const { page, pageSize, setPage, setPageSize } = usePaging("inbox");
  const topRef = useRef(null);

  // A new search also starts again from page 1 (the page number is
  // left out of the address)
  function setSearch(value) {
    setSearchParams(value ? { search: value } : {}, { replace: true });
  }

  // Wraps a setter so changing any filter also goes back to the first page
  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  // Moving to another page: back to the top of the list
  function goToPage(n) {
    setPage(n);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const activeFilterCount = [priority, department, assignee].filter(
    (v) => v !== "any",
  ).length;

  function clearFilters() {
    setPriority("any");
    setDepartment("any");
    setAssignee("any");
    setSearch("");
  }

  // 1. Everything except the tab (used for the tab counts)
  const text = search.trim().toLowerCase();
  const filtered = tickets.filter(
    (t) =>
      matchesSearch(t, text) &&
      (priority === "any" || t.priority === Number(priority)) &&
      (department === "any" ||
        (department === "none"
          ? !t.department
          : t.department === department)) &&
      (assignee === "any" ||
        (assignee === "none" ? !t.assignee : t.assignee === assignee)),
  );

  // 2. Then the tab, then sorting
  const results = filtered
    .filter((t) => matchesTab(t, tab))
    .sort(SORTS[sort].compare);
  // The list got shorter (e.g. a filter): stay on a page that exists
  const currentPage = Math.min(page, pageCount(results.length, pageSize));
  const shown = pageOf(results, currentPage, pageSize);
  const needAttention = tickets.filter((t) => !isDone(t)).length;
  const overdueCount = tickets.filter(isOverdue).length;

  const openTicket = (t) => navigate(`/tickets/${t.id}`);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {/* Header */}
      <div ref={topRef} className="scroll-mt-20">
        <h1 className="text-2xl font-semibold sm:text-3xl">Inbox</h1>
        <p className="mt-1 text-sm text-muted">
          {needAttention} tickets need attention
          {overdueCount > 0 && (
            <span className="font-medium text-red-500">
              , {overdueCount} overdue
            </span>
          )}
        </p>
      </div>

      {/* Status tabs: scroll sideways on small screens */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-lg border border-line bg-white p-1">
          {TABS.map((t) => {
            const count = filtered.filter((ticket) =>
              matchesTab(ticket, t.id),
            ).length;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => resetPage(setTab)(t.id)}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition active:scale-[0.97] ${
                  tab === t.id
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-muted hover:text-ink"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${tab === t.id ? "bg-brand text-white" : "bg-page text-muted"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search, filters and sort */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets or customers"
              enterKeyHint="search"
              className={`${inputClass} pl-9`}
            />
          </div>
          {/* Phones: filters hide behind this button */}
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className={`relative flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition active:scale-[0.97] md:hidden ${
              showFilters || activeFilterCount
                ? "border-brand bg-brand/10 text-brand"
                : "border-line bg-white text-muted"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-xs text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div
          className={`grid-cols-2 gap-2 md:grid md:grid-cols-4 ${showFilters ? "grid" : "hidden"}`}
        >
          <select
            value={priority}
            onChange={(e) => resetPage(setPriority)(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="any">Any priority</option>
            {Object.entries(PRIORITIES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => resetPage(setDepartment)(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="any">Any department</option>
            <option value="none">No team yet</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={assignee}
            onChange={(e) => resetPage(setAssignee)(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="any">Anyone</option>
            <option value="none">Unassigned</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => resetPage(setSort)(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            {Object.entries(SORTS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {results.length} ticket{results.length === 1 ? "" : "s"}
          </span>
          {(activeFilterCount > 0 || search) && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex cursor-pointer items-center gap-1 font-medium text-brand hover:underline"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white px-6 py-14 text-center">
          <InboxIcon className="h-8 w-8 text-muted" />
          <p className="font-medium">No tickets here</p>
          <p className="text-sm text-muted">
            Try another tab, or clear your search and filters.
          </p>
        </div>
      ) : (
        <>
          {/* Big screens: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white xl:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="whitespace-nowrap border-b border-line text-muted">
                  <th className="px-3 py-3 font-medium">Ticket</th>
                  <th className="px-3 py-3 font-medium">Priority</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="hidden px-3 py-3 font-medium 2xl:table-cell">
                    Department
                  </th>
                  <th className="px-3 py-3 font-medium">Assignee</th>
                  <th className="px-3 py-3 font-medium">Due</th>
                  <th className="hidden px-3 py-3 font-medium 2xl:table-cell">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => openTicket(t)}
                    className={`group cursor-pointer border-b border-line transition last:border-0 hover:bg-brand/5 active:bg-brand/10 ${
                      isOverdue(t) ? "bg-red-50/50" : ""
                    }`}
                  >
                    <td className="px-3 py-3">
                      {/* max-w + truncate: long subjects get "…" instead of stretching the table */}
                      <div className="max-w-80 2xl:max-w-md">
                        <p className="truncate font-medium transition group-hover:text-brand">
                          <span className="mr-2 text-muted">#{t.id}</span>
                          {t.subject}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {t.requester.name}
                          {t.requester.company && ` · ${t.requester.company}`}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 2xl:table-cell">
                      {findDepartment(t.department).name}
                    </td>
                    <td className="px-3 py-3">
                      <AssigneeLabel id={t.assignee} />
                    </td>
                    <td className="px-3 py-3">
                      <DueLabel ticket={t} />
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-muted 2xl:table-cell">
                      {timeAgo(t.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones, tablets and small laptops: cards */}
          {/* grid-cols-1 and min-w-0: a long name or company is cut off
              with "…" instead of making the card wider than the phone */}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
            {shown.map((t) => (
              <li key={t.id} className="min-w-0">
                <div
                  onClick={() => openTicket(t)}
                  className={`group cursor-pointer rounded-xl border bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md active:scale-[0.99] active:bg-brand/5 ${
                    isOverdue(t) ? "border-red-200" : "border-line"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="font-medium">#{t.id}</span>
                    <span>{timeAgo(t.updatedAt)}</span>
                  </div>
                  <p className="mt-1 font-medium transition group-hover:text-brand">
                    {t.subject}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {t.requester.name}
                    {t.requester.company && ` · ${t.requester.company}`}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <StatusBadge status={t.status} />
                    <PriorityBadge priority={t.priority} />
                    <DueLabel ticket={t} />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm text-muted">
                    <span>{findDepartment(t.department).name}</span>
                    <AssigneeLabel id={t.assignee} />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            page={currentPage}
            pageSize={pageSize}
            total={results.length}
            onPage={goToPage}
            onPageSize={setPageSize}
            what="tickets"
          />
        </>
      )}
    </div>
  );
}
