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
  ExternalLink,
  TicketX,
} from "lucide-react";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import PriorityBadge from "../PriorityBadge";
import DueLabel from "../DueLabel";
import { inputClass, labelClass } from "../formStyles";
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

const SOURCES = {
  email: "Email",
  portal: "Customer portal",
  phone: "Phone",
  agent: "Created by an agent",
};

// One entry in the conversation
function Message({ message }) {
  // Status changes, assignments etc.: a small line in the middle
  if (message.kind === "event") {
    return (
      <li className="flex justify-center">
        <span className="rounded-full bg-white px-3 py-1 text-center text-xs text-muted ring-1 ring-line">
          <span className="font-medium text-ink">{message.author}</span>{" "}
          {message.body} · {timeAgo(message.at)}
        </span>
      </li>
    );
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
            Only agents see this
          </span>
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
        {message.body}
      </p>
    </li>
  );
}

// The box at the bottom for writing a reply or a note
function Composer({ ticket, onSend }) {
  const [kind, setKind] = useState("agent"); // "agent" = reply to customer, "note" = internal
  const [body, setBody] = useState("");
  const [thenStatus, setThenStatus] = useState(""); // "" = keep the current status

  function send() {
    if (!body.trim()) return;
    onSend(kind, body.trim(), thenStatus || null);
    setBody("");
    setThenStatus("");
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
          // Ctrl+Enter (or Cmd+Enter on Mac) sends
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
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

      <div className="flex flex-col gap-2 border-t border-line p-3 sm:flex-row sm:items-center sm:justify-end">
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
          disabled={!body.trim()}
          className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium text-white transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
            isNote
              ? "bg-amber-500 hover:bg-amber-500/90"
              : "bg-brand hover:bg-brand/90"
          }`}
        >
          <Send className="h-4 w-4" />
          {isNote ? "Add note" : "Send reply"}
        </button>
      </div>
    </div>
  );
}

// The panel with status, priority, department, assignee and due date
function Properties({ ticket, onChange }) {
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
          value={ticket.department}
          onChange={(e) => onChange({ department: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Assigned to
        <select
          value={ticket.assignee ?? ""}
          onChange={(e) => onChange({ assignee: e.target.value || null })}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">Unassigned</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

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
    </div>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tickets, updateTicket, addMessage } = useData();
  const [showDetails, setShowDetails] = useState(false); // phones only

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
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <DueLabel ticket={ticket} />
            <span className="text-sm text-muted">
              Opened {timeAgo(ticket.createdAt)} via{" "}
              {SOURCES[ticket.source] ?? ticket.source}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Right side on desktop: ticket details and customer */}
        <aside className="flex flex-col gap-4 lg:order-2">
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
                onChange={(changes) => updateTicket(ticket.id, changes)}
              />
            </div>
          </div>

          <div className="hidden rounded-xl border border-line bg-white p-4 lg:block">
            <CustomerCard customer={customer} otherOpen={otherOpen} />
          </div>
        </aside>

        {/* Left side: the conversation */}
        <section className="flex min-w-0 flex-col gap-4 lg:order-1">
          <ul className="flex flex-col gap-3">
            {ticket.messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
          </ul>

          <Composer
            ticket={ticket}
            onSend={(kind, body, status) =>
              addMessage(ticket.id, kind, body, status)
            }
          />

          {/* Phones and tablets: customer card goes below the conversation */}
          <div className="rounded-xl border border-line bg-white p-4 lg:hidden">
            <CustomerCard customer={customer} otherOpen={otherOpen} />
          </div>
        </section>
      </div>
    </div>
  );
}

function CustomerCard({ customer, otherOpen }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold">Customer</p>
      <Link
        to={`/customers/${customer.id}`}
        className="group flex items-center gap-3"
      >
        <Avatar name={customer.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium group-hover:text-brand">
            {customer.name}
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            {customer.company ? (
              <Building2 className="h-3 w-3 shrink-0" />
            ) : (
              <UserRound className="h-3 w-3 shrink-0" />
            )}
            {customer.company ?? "Individual"}
          </p>
        </div>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted group-hover:text-brand" />
      </Link>

      <div className="flex flex-col gap-2 text-sm">
        <a
          href={`mailto:${customer.email}`}
          className="flex items-center gap-2 text-muted hover:text-brand"
        >
          <Mail className="h-4 w-4 shrink-0" />
          <span className="truncate">{customer.email}</span>
        </a>
        {customer.phone && (
          <a
            href={`tel:${customer.phone}`}
            className="flex items-center gap-2 text-muted hover:text-brand"
          >
            <Phone className="h-4 w-4 shrink-0" />
            {customer.phone}
          </a>
        )}
      </div>

      {otherOpen.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs font-medium text-muted">
            Other open tickets
          </p>
          <ul className="flex flex-col gap-1">
            {otherOpen.slice(0, 3).map((t) => (
              <li key={t.id}>
                <Link
                  to={`/tickets/${t.id}`}
                  className="block truncate rounded-md px-2 py-1.5 text-sm transition hover:bg-brand/5 hover:text-brand"
                >
                  <span className="text-muted">#{t.id}</span> {t.subject}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
