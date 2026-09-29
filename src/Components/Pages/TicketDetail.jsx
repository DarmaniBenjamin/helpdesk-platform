import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Lock,
  Send,
  ChevronDown,
  Mail,
  Phone,
  Building2,
  UserRound,
  TicketX,
  BookOpen,
  CircleCheck,
  TriangleAlert,
  Trash2,
  Hand,
  Tag,
} from "lucide-react";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import PriorityBadge from "../PriorityBadge";
import DueLabel from "../DueLabel";
import Modal from "../Modal";
import { AttachButton, AttachmentChips, AttachmentList } from "../Attachments";
import useAttachments from "../useAttachments";
import { inputClass, labelClass, secondaryButton } from "../formStyles";
import { can } from "../teamRoles";
import { extractKeywords, relevance } from "../Knowledge";
import useData from "../../useData";
import {
  STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  AGENTS,
  isDone,
  timeAgo,
} from "../../data";

// Turns a time into the format a date-time input expects, e.g. "2026-09-24T17:30"
function toInputValue(time) {
  const date = new Date(time);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(time) {
  return new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Link to one saved answer in the Knowledge Base, already searched and opened
function answerLink(answer) {
  return `/knowledge-base?search=${encodeURIComponent(answer.title)}&open=${answer.id}`;
}

const SOURCES = {
  email: "Email",
  portal: "Customer portal",
  phone: "Phone",
  agent: "Created by an agent",
};

// One entry in the conversation. `onDelete` is only given for internal
// notes this person may delete (their own, or any if they're an Admin).
function Message({ message, onDelete }) {
  // Deleting asks "are you sure?" right on the note first
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function confirmDelete() {
    setDeleting(true);
    setError("");
    try {
      await onDelete(message);
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  const styles = {
    customer: "border-line bg-white",
    agent: "border-brand/30 bg-brand/5",
    note: "border-dashed border-amber-300 bg-amber-50",
  };

  return (
    <li className={`rounded-xl border p-4 ${styles[message.kind]}`}>
      <div className="flex items-center gap-3">
        <Avatar name={message.author} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{message.author}</p>
          <p className="text-xs text-muted">
            {message.kind === "customer"
              ? "Customer"
              : message.kind === "agent"
                ? "Replied"
                : "Internal note"}
            {" · "}
            <span title={formatDate(message.at)}>{timeAgo(message.at)}</span>
          </p>
        </div>
        {message.kind === "note" && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            <Lock className="h-3 w-3" />
            <span className="hidden sm:inline">Only agents see this</span>
            <span className="sm:hidden">Internal</span>
          </span>
        )}
        {onDelete && !confirming && (
          <button
            type="button"
            aria-label="Delete this note"
            title="Delete this note"
            onClick={() => setConfirming(true)}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-amber-700/70 transition hover:bg-red-50 hover:text-red-500 active:scale-[0.92]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 sm:flex-row sm:items-center">
          <p className="flex-1">
            Delete this note
            {message.attachments?.length ? " and its files" : ""}? This can't be
            undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError("");
              }}
              disabled={deleting}
              className="h-9 flex-1 cursor-pointer rounded-lg border border-red-200 bg-white px-3 text-sm transition hover:bg-red-100 sm:flex-none"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="h-9 flex-1 cursor-pointer rounded-lg bg-red-500 px-3 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:flex-none"
            >
              {deleting ? "Deleting…" : "Delete note"}
            </button>
          </div>
          {error && <p className="w-full text-xs">{error}</p>}
        </div>
      )}
      {message.body && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
          {message.body}
        </p>
      )}
      <AttachmentList files={message.attachments} />
    </li>
  );
}

// The box at the bottom for writing a reply or a note
function Composer({ ticket, onSend }) {
  const [kind, setKind] = useState("agent"); // "agent" = reply to customer, "note" = internal
  const [body, setBody] = useState("");
  const [thenStatus, setThenStatus] = useState(""); // "" = keep the current status

  // Save the note to the Knowledge Base? null = decide automatically:
  // yes when resolving or closing (the note is probably the fix), otherwise no.
  // Once the checkbox is clicked, that choice is used instead.
  const [saveChoice, setSaveChoice] = useState(null);
  const resolving = thenStatus === "resolved" || thenStatus === "closed";
  const saveToAnswers = saveChoice ?? resolving;

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  // Files to send with it: picked with the paperclip, dropped on the
  // box, or pasted (e.g. a screenshot)
  const attach = useAttachments();
  const canSend =
    (body.trim() || attach.files.length > 0) && !attach.uploading && !sending;

  // Saves to the database. What you wrote is only cleared once it's
  // saved, so nothing is lost if it doesn't go through.
  async function send() {
    if (!canSend) return;
    setSending(true);
    setSendError("");
    try {
      await onSend(
        kind,
        body.trim(),
        thenStatus || null,
        kind === "note" && saveToAnswers && Boolean(body.trim()),
        attach.ids,
      );
      setBody("");
      setThenStatus("");
      setSaveChoice(null);
      attach.clear();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  const isNote = kind === "note";

  return (
    <div
      className={`rounded-xl border bg-white ${isNote ? "border-amber-300" : "border-line"}`}
    >
      <div className="flex border-b border-line text-sm">
        {[
          { id: "agent", label: "Reply to customer" },
          { id: "note", label: "Internal note" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setKind(tab.id)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 px-4 py-3 transition sm:flex-none ${
              kind === tab.id
                ? `border-b-2 font-medium ${tab.id === "note" ? "border-amber-500 text-amber-700" : "border-brand text-brand"}`
                : "text-muted hover:text-ink"
            }`}
          >
            {tab.id === "note" && <Lock className="h-3.5 w-3.5" />}
            {tab.label}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter (or Cmd+Enter on Mac) sends, without adding a new line
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
        // Pasting a screenshot attaches it
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            attach.add(e.clipboardData.files);
          }
        }}
        // Dropping files on the box attaches them
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            attach.add(e.dataTransfer.files);
          }
        }}
        rows={4}
        placeholder={
          isNote
            ? "Write a note for your team. The customer won't see it."
            : `Write your reply to ${ticket.requester.name.split(" ")[0]}...`
        }
        className={`block w-full resize-y border-0 px-4 py-3 text-base placeholder:text-muted focus:outline-none sm:text-sm ${
          isNote ? "bg-amber-50/50" : "bg-white"
        }`}
      />

      {(attach.files.length > 0 || attach.uploading > 0 || attach.error) && (
        <div className="border-t border-line px-4 py-3">
          <AttachmentChips attach={attach} />
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <AttachButton attach={attach} className="sm:mr-auto" />
        {isNote && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-amber-800">
            <input
              type="checkbox"
              checked={saveToAnswers}
              onChange={(e) => setSaveChoice(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-amber-500"
            />
            Also save to Knowledge Base
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="whitespace-nowrap">Then set status</span>
          <select
            value={thenStatus}
            onChange={(e) => setThenStatus(e.target.value)}
            className={`${inputClass} h-10 cursor-pointer sm:w-60`}
          >
            <option value="">Keep as {STATUSES[ticket.status].label}</option>
            {Object.entries(STATUSES)
              .filter(([id]) => id !== ticket.status)
              .map(([id, { label }]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium text-white transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
            isNote
              ? "bg-amber-500 hover:bg-amber-500/90"
              : "bg-brand hover:bg-brand/90"
          }`}
        >
          <Send className="h-4 w-4" />
          {sending ? "Sending…" : isNote ? "Add note" : "Send reply"}
        </button>
      </div>
      {sendError && (
        <p className="border-t border-line px-4 py-2.5 text-sm text-red-500">
          {sendError}
        </p>
      )}
    </div>
  );
}

// Who the ticket is for, in one line under the title: their name (opens
// their page), business, buttons to call or email them, and how many
// other tickets of theirs are still open (also opens their page, where
// they're listed)
function CustomerLine({ customer, otherOpen }) {
  const iconLink =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white text-muted transition hover:border-brand/40 hover:text-brand active:scale-[0.95]";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <Link
        to={`/customers/${customer.id}`}
        className="flex min-w-0 items-center gap-2 font-medium hover:text-brand"
      >
        <Avatar name={customer.name} size="sm" />
        <span className="truncate">{customer.name}</span>
      </Link>
      <span className="flex min-w-0 items-center gap-1 text-muted">
        {customer.company ? (
          <Building2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <UserRound className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{customer.company ?? "Individual"}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {customer.phone && (
          <a
            href={`tel:${customer.phone}`}
            title={`Call ${customer.phone}`}
            aria-label={`Call ${customer.name}`}
            className={iconLink}
          >
            <Phone className="h-4 w-4" />
          </a>
        )}
        {customer.email ? (
          <a
            href={`mailto:${customer.email}`}
            title={`Email ${customer.email}`}
            aria-label={`Email ${customer.name}`}
            className={iconLink}
          >
            <Mail className="h-4 w-4" />
          </a>
        ) : (
          <Link
            to={`/customers/${customer.id}`}
            title="No email yet: add one on their page"
            className="text-xs text-muted hover:text-brand"
          >
            No email yet
          </Link>
        )}
      </span>
      {otherOpen.length > 0 && (
        <Link
          to={`/customers/${customer.id}`}
          className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand transition hover:bg-brand/20"
        >
          {otherOpen.length} other open ticket
          {otherOpen.length === 1 ? "" : "s"}
        </Link>
      )}
    </div>
  );
}

// The panel with status, priority, department, assignee and due date
function Properties({ ticket, me, onChange, onDelete }) {
  return (
    <div className="flex flex-col gap-4">
      <label className={labelClass}>
        Status
        <select
          value={ticket.status}
          onChange={(e) => onChange({ status: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          {Object.entries(STATUSES).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className={labelClass}>
        Priority
        <div className="grid grid-cols-4 gap-1.5">
          {Object.entries(PRIORITIES).map(([value, { label }]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ priority: Number(value) })}
              className={`h-9 cursor-pointer rounded-lg border text-xs transition active:scale-[0.97] ${
                ticket.priority === Number(value)
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line text-muted hover:border-brand/40 hover:text-brand"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className={labelClass}>
        Department
        <select
          value={ticket.department ?? ""}
          onChange={(e) => onChange({ department: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          {/* Only shown while the ticket has no team, e.g. a new request
              from the customer portal. Once a team is picked, it goes away. */}
          {!ticket.department && (
            <option value="" disabled>
              No team yet: pick one
            </option>
          )}
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <div className={labelClass}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="assignee">Assigned to</label>
          {/* A tech picking up a ticket nobody (or someone else) has */}
          {ticket.assignee !== me.id && (
            <button
              type="button"
              onClick={() => onChange({ assignee: me.id })}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand transition hover:bg-brand/10 active:scale-[0.97]"
            >
              <Hand className="h-3.5 w-3.5" />
              Assign to me
            </button>
          )}
        </div>
        <select
          id="assignee"
          value={ticket.assignee ?? ""}
          onChange={(e) => onChange({ assignee: e.target.value || null })}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">Unassigned</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.title ? ` · ${a.title}` : ""}
            </option>
          ))}
        </select>
      </div>

      <label className={labelClass}>
        Due by
        <input
          type="datetime-local"
          value={toInputValue(ticket.dueBy)}
          onChange={(e) =>
            e.target.value &&
            onChange({ dueBy: new Date(e.target.value).getTime() })
          }
          className={`${inputClass} block cursor-pointer appearance-none text-left`}
        />
        <DueLabel ticket={ticket} />
      </label>

      {/* Admins and the Super Admin only; asks before deleting */}
      {can(me.role, "deleteTickets") && (
        <button
          type="button"
          onClick={onDelete}
          className="mt-1 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-red-200 text-sm text-red-500 transition hover:bg-red-50 active:scale-[0.97]"
        >
          <Trash2 className="h-4 w-4" />
          Delete ticket
        </button>
      )}
    </div>
  );
}

// "Are you sure?" before deleting a ticket. It can't be undone, so the
// ticket number has to be typed in first.
function DeleteTicketModal({ ticket, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = typed.trim().replace(/^#/, "") === String(ticket.id);

  async function handleDelete(e) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Delete ticket #${ticket.id}?`}
      onClose={onClose}
      onSubmit={handleDelete}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Keep it
          </button>
          <button
            type="submit"
            disabled={!matches || busy}
            className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {busy ? "Deleting…" : "Delete for good"}
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-line bg-page p-3 text-sm">
        <p className="font-medium">{ticket.subject}</p>
        <p className="text-muted">
          {ticket.requester.name}
          {ticket.requester.company && ` · ${ticket.requester.company}`}
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This deletes the ticket and its whole conversation, internal notes and
          history, for good. <strong>It can't be undone.</strong> Knowledge Base
          answers saved from it stay.
        </p>
      </div>
      <p className="text-sm text-muted">
        Finished with it? Setting the status to <strong>Closed</strong> keeps it
        for your records instead.
      </p>

      <label className={labelClass}>
        <span>
          Type <strong>{ticket.id}</strong> to confirm
        </span>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setError("");
          }}
          placeholder={String(ticket.id)}
          className={inputClass}
        />
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    me,
    tickets,
    updateTicket,
    deleteTicket,
    addMessage,
    deleteNote,
    answers,
    addAnswer,
  } = useData();
  const [showDetails, setShowDetails] = useState(false); // phones only
  // A message if a change (status, assignee...) didn't save
  const [changeError, setChangeError] = useState("");
  const [savedAnswer, setSavedAnswer] = useState(null); // the answer just saved from a note
  const [deleting, setDeleting] = useState(false); // the "are you sure?" box

  const ticket = tickets.find((t) => t.id === Number(id));

  // Go back to wherever you came from (Inbox, a customer, the dashboard...)
  function goBack() {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/inbox");
  }

  if (!ticket) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <TicketX className="h-10 w-10 text-muted" />
        <h1 className="text-xl font-semibold">Ticket #{id} doesn't exist</h1>
        <Link
          to="/inbox"
          className="text-sm font-medium text-brand hover:underline"
        >
          Back to Inbox
        </Link>
      </div>
    );
  }

  const customer = ticket.requester;
  const otherOpen = tickets.filter(
    (t) =>
      t.customerId === ticket.customerId && t.id !== ticket.id && !isDone(t),
  );

  // Saved answers that share keywords with this ticket: likely fixes.
  // Answers that were saved from this same ticket are left out.
  const ticketKeywords = extractKeywords(
    `${ticket.subject} ${ticket.subject} ${ticket.description}`,
    8,
  );
  const suggested = answers
    .filter((a) => a.ticketId !== ticket.id)
    .map((a) => ({ answer: a, score: relevance(a, ticketKeywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.answer);

  // Sends a reply or note to the server (throws if it doesn't save, so
  // the reply box can keep what was written)
  async function handleSend(kind, body, status, saveToAnswers, attachmentIds) {
    await addMessage(ticket.id, kind, body, status, attachmentIds);
    if (saveToAnswers) {
      // The ticket's subject becomes the title, the ticket's description the problem,
      // and the note the fix. Keywords are picked from all three.
      // The note is already saved, so if this part fails, say so
      // instead of letting the note be sent twice
      try {
        const answer = await addAnswer({
          title: ticket.subject,
          problem: ticket.description,
          solution: body,
          department: ticket.department,
          ticketId: ticket.id,
          source: "note",
          keywords: extractKeywords(
            `${ticket.subject} ${ticket.subject} ${ticket.description} ${body}`,
          ),
        });
        setSavedAnswer(answer);
      } catch (err) {
        setSavedAnswer(null);
        setChangeError(
          `The note was added, but it couldn't be saved to the Knowledge Base: ${err.message}`,
        );
      }
    } else {
      setSavedAnswer(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={goBack}
          className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted transition hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div>
          <p className="text-sm font-medium text-muted">Ticket #{ticket.id}</p>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            {ticket.subject}
          </h1>
          <CustomerLine customer={customer} otherOpen={otherOpen} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <DueLabel ticket={ticket} />
            <span className="text-sm text-muted">
              Opened {timeAgo(ticket.createdAt)} via{" "}
              {SOURCES[ticket.source] ?? ticket.source}
            </span>
          </div>
          {/* Tags, e.g. brought over from Freshdesk */}
          {ticket.tags?.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {ticket.tags.map((tag) => (
                <li
                  key={tag}
                  className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {changeError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {changeError}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Right side on desktop: ticket details.
            Desktop: stays pinned in view while the conversation scrolls,
            and scrolls on its own if it's taller than the screen
            (7rem = the top bar plus the page's padding above and below). */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-0 lg:order-2 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
          <div className="rounded-xl border border-line bg-white">
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="flex w-full cursor-pointer items-center justify-between p-4 lg:cursor-default"
            >
              <span className="font-semibold">Ticket details</span>
              <ChevronDown
                className={`h-4 w-4 text-muted transition lg:hidden ${showDetails ? "rotate-180" : ""}`}
              />
            </button>
            <div
              className={`border-t border-line p-4 lg:block ${showDetails ? "block" : "hidden"}`}
            >
              <Properties
                ticket={ticket}
                me={me}
                onChange={async (changes) => {
                  setChangeError("");
                  try {
                    await updateTicket(ticket.id, changes);
                  } catch (err) {
                    setChangeError(err.message);
                  }
                }}
                onDelete={() => setDeleting(true)}
              />
            </div>
          </div>

          {suggested.length > 0 && (
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="mb-2 flex items-center gap-2 font-semibold">
                <BookOpen className="h-4 w-4 text-brand" />
                Suggested fixes
              </p>
              <ul className="flex flex-col gap-1">
                {suggested.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={answerLink(a)}
                      className="block rounded-md px-2 py-1.5 text-sm transition hover:bg-brand/5 hover:text-brand"
                    >
                      <span className="block truncate font-medium">
                        {a.title}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {a.solution}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* Left side: the conversation */}
        <section className="flex min-w-0 flex-col gap-4 lg:order-1">
          {/* Only the messages and notes. Changes (status, assigned,
              priority...) aren't shown here: they go to the bell. */}
          <ul className="flex flex-col gap-3">
            {ticket.messages
              .filter((m) => m.kind !== "event")
              .map((m) => (
                <Message
                  key={m.id}
                  message={m}
                  // Notes can be deleted by whoever wrote them, or an Admin
                  onDelete={
                    m.kind === "note" &&
                    (m.authorId === me.id || can(me.role, "deleteTickets"))
                      ? (note) => deleteNote(ticket.id, note.id)
                      : undefined
                  }
                />
              ))}
          </ul>

          {savedAnswer?.ticketId === ticket.id && (
            <div className="flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-2.5 text-sm text-brand">
              <CircleCheck className="h-4 w-4 shrink-0" />
              <p className="flex-1">
                Note saved to the{" "}
                <Link
                  to={answerLink(savedAnswer)}
                  className="font-medium underline"
                >
                  Knowledge Base
                </Link>{" "}
                with keywords: {savedAnswer.keywords.join(", ")}
              </p>
            </div>
          )}

          {/* key: a fresh reply box for every ticket, so drafts never follow you */}
          <Composer key={ticket.id} ticket={ticket} onSend={handleSend} />
        </section>
      </div>

      {deleting && (
        <DeleteTicketModal
          ticket={ticket}
          onConfirm={async () => {
            await deleteTicket(ticket.id);
            navigate("/inbox", { replace: true });
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
