import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Search,
  Plus,
  ChevronDown,
  Copy,
  Check,
  Pencil,
  BookOpen,
  Ticket,
  X,
} from "lucide-react";
import AnswerModal from "../AnswerModal";
import Avatar from "../Avatar";
import { inputClass } from "../formStyles";
import { matchesAnswer } from "../Knowledge";
import { copyText } from "../copyText";
import useData from "../../useData";
import { DEPARTMENTS, findDepartment, timeAgo } from "../../data";

const SORTS = {
  recent: {
    label: "Most recent",
    compare: (a, b) => b.updatedAt - a.updatedAt,
  },
  used: {
    label: "Most used",
    compare: (a, b) => b.uses - a.uses || b.updatedAt - a.updatedAt,
  },
  title: { label: "A to Z", compare: (a, b) => a.title.localeCompare(b.title) },
};

function AnswerCard({ answer, open, onToggle, onEdit, onKeyword, onCopy }) {
  const [copied, setCopied] = useState(false);

  // copyText also works on plain http (e.g. from another device on
  // your network), where the browser's normal copy is switched off
  async function copySolution() {
    if (await copyText(answer.solution, "Copy this answer:")) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    onCopy(); // counts as used either way
  }

  return (
    <li
      className={`group rounded-xl border bg-white transition duration-200 ${
        open
          ? "border-brand/40 shadow-md"
          : "border-line hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
      }`}
    >
      {/* The summary row: tap to open or close */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <BookOpen className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium transition group-hover:text-brand">
            {answer.title}
          </span>
          <span
            className={`mt-0.5 block text-sm text-muted ${open ? "" : "line-clamp-1"}`}
          >
            {answer.problem}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="rounded-md bg-page px-2 py-0.5 font-medium text-ink">
              {findDepartment(answer.department).name}
            </span>
            <span>
              {answer.source === "note" ? "From a ticket note" : "Written by"}{" "}
              {answer.author}
            </span>
            <span>Updated {timeAgo(answer.updatedAt)}</span>
            {answer.uses > 0 && <span>Used {answer.uses}×</span>}
          </span>
        </span>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* The full answer */}
      {open && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted">
              THE PROBLEM
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {answer.problem}
            </p>
          </div>
          <div className="rounded-lg bg-brand/5 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-brand">
              HOW IT WAS FIXED
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {answer.solution}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {answer.keywords.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => onKeyword(word)}
                title={`Search for "${word}"`}
                className="cursor-pointer rounded-md border border-line bg-page px-2 py-0.5 text-xs transition hover:border-brand/40 hover:text-brand"
              >
                {word}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={copySolution}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy fix"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            {answer.ticketId && (
              <Link
                to={`/tickets/${answer.ticketId}`}
                className="flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
              >
                <Ticket className="h-4 w-4" />
                Ticket #{answer.ticketId}
              </Link>
            )}
            <span className="ml-auto flex items-center gap-2 text-xs text-muted">
              <Avatar name={answer.author} size="sm" />
              {answer.author}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

export default function SavedAnswers() {
  const { answers, addAnswer, updateAnswer, deleteAnswer, recordAnswerUse } =
    useData();

  // The search lives in the URL (?search=...), so a ticket page can link here with a search ready
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";

  const [team, setTeam] = useState("all");
  const [sort, setSort] = useState("recent");
  // A ticket page can also say which answer to open (?open=3)
  const [openId, setOpenId] = useState(
    () => Number(searchParams.get("open")) || null,
  );
  const [editing, setEditing] = useState(null); // null, "new", or an answer

  function setSearch(value) {
    setSearchParams(value ? { search: value } : {}, { replace: true });
  }

  // How many answers each team has (after the search), for the filter buttons
  const searched = answers.filter((a) => matchesAnswer(a, search.trim()));
  const teamCount = (id) =>
    id === "all"
      ? searched.length
      : searched.filter((a) => a.department === id).length;

  const results = searched
    .filter((a) => team === "all" || a.department === team)
    .sort(SORTS[sort].compare);
  const fromNotes = answers.filter((a) => a.source === "note").length;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted">
            Your team's knowledge base: {answers.length} fixes, {fromNotes}{" "}
            saved straight from ticket notes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          New answer
        </button>
      </div>

      {/* Search and sort */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by problem, fix or keyword, e.g. printer offline"
            enterKeyHint="search"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className={`${inputClass} cursor-pointer sm:w-44`}
        >
          {Object.entries(SORTS).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Team filter: scrolls sideways on small screens */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-lg border border-line bg-white p-1">
          {[{ id: "all", name: "All teams" }, ...DEPARTMENTS].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setTeam(d.id)}
              className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition active:scale-[0.97] ${
                team === d.id
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {d.name}
              <span
                className={`rounded-full px-1.5 text-xs ${team === d.id ? "bg-brand text-white" : "bg-page text-muted"}`}
              >
                {teamCount(d.id)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {search && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {results.length} answer{results.length === 1 ? "" : "s"} for "
            {search}"
          </span>
          <button
            type="button"
            onClick={() => setSearch("")}
            className="flex cursor-pointer items-center gap-1 font-medium text-brand hover:underline"
          >
            <X className="h-3.5 w-3.5" />
            Clear search
          </button>
        </div>
      )}

      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white px-6 py-14 text-center">
          <BookOpen className="h-8 w-8 text-muted" />
          <p className="font-medium">No saved answers found</p>
          <p className="text-sm text-muted">
            Try fewer words, another team, or add a new answer.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((a) => (
            <AnswerCard
              key={a.id}
              answer={a}
              open={openId === a.id}
              onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              onEdit={() => setEditing(a)}
              onKeyword={(word) => setSearch(word)}
              onCopy={() => recordAnswerUse(a.id)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <AnswerModal
          answer={editing === "new" ? null : editing}
          onSave={(fields) =>
            editing === "new"
              ? addAnswer(fields)
              : updateAnswer(editing.id, fields)
          }
          onDelete={() => deleteAnswer(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
