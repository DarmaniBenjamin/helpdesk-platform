import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  ArrowLeft,
  CircleCheck,
  MessageCircleReply,
  Send,
  Star,
  Lock,
} from "lucide-react";
import Avatar from "../Avatar";
import PortalStatusBadge from "./PortalStatusBadge";
import { inputClass } from "../formStyles";
import { isDone, timeAgo } from "../../data";
import useData from "../../useData";

function formatDate(time) {
  return new Date(time).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// One message. The customer's own are on the right in green,
// the support team's on the left.
function Bubble({ message, mine }) {
  return (
    <li className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
      {!mine && <Avatar name={message.author} size="sm" />}
      <div className={`max-w-[85%] sm:max-w-[75%] ${mine ? "text-right" : ""}`}>
        <p className="text-xs text-muted">
          {mine ? "You" : message.author} · {timeAgo(message.at)}
        </p>
        <div
          className={`mt-1 whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-left text-sm ${
            mine
              ? "rounded-tr-sm bg-brand text-white"
              : "rounded-tl-sm border border-line bg-white"
          }`}
        >
          {message.body}
        </div>
      </div>
    </li>
  );
}

// "How did we do?" with 1-5 stars, on finished requests
function Rating({ ticket }) {
  const { rateTicket } = useData();
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");

  if (ticket.feedback) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-5">
        <p className="text-sm font-medium">Thanks for your feedback</p>
        <div
          className="flex gap-1"
          aria-label={`${ticket.feedback.rating} out of 5 stars`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`h-5 w-5 ${
                n <= ticket.feedback.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-line"
              }`}
            />
          ))}
        </div>
        {ticket.feedback.comment && (
          <p className="text-sm text-muted">"{ticket.feedback.comment}"</p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (stars) rateTicket(ticket.id, stars, comment);
      }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5"
    >
      <p className="text-sm font-medium">How did we do?</p>
      <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setStars(n)}
            onMouseEnter={() => setHover(n)}
            className="cursor-pointer rounded p-1 transition active:scale-90"
          >
            <Star
              className={`h-7 w-7 transition ${
                n <= (hover || stars)
                  ? "fill-amber-400 text-amber-400"
                  : "text-line"
              }`}
            />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you'd like to add? (optional)"
            className={`${inputClass} h-auto resize-y py-2.5`}
          />
          <div className="grid sm:flex sm:justify-end">
            <button
              type="submit"
              className="h-11 cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
            >
              Send feedback
            </button>
          </div>
        </>
      )}
    </form>
  );
}

// One of the customer's requests: the conversation, replying, and rating.
// Internal notes and history lines are never shown here.
export default function PortalTicket() {
  const { id } = useParams();
  const { state } = useLocation();
  const { me, tickets, addMessage, updateTicket } = useData();
  const [reply, setReply] = useState("");

  const ticket = tickets.find((t) => String(t.id) === id);

  // Not theirs (or doesn't exist): same message either way, so nobody can
  // find out which ticket numbers exist
  if (!ticket || ticket.customerId !== me.customerId) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <h1 className="text-xl font-semibold">We couldn't find that request</h1>
        <Link to="/portal" className="text-sm font-medium text-brand">
          Back to my requests
        </Link>
      </div>
    );
  }

  const done = isDone(ticket);
  const closed = ticket.status === "closed";
  const conversation = ticket.messages.filter(
    (m) => m.kind === "customer" || m.kind === "agent",
  );

  function sendReply(e) {
    e.preventDefault();
    const body = reply.trim();
    if (!body) return;
    // A reply on a request we're waiting on, or one marked resolved,
    // puts it back in the team's queue
    const reopen = ["waiting", "resolved"].includes(ticket.status)
      ? "open"
      : undefined;
    addMessage(ticket.id, "customer", body, reopen);
    setReply("");
    document.activeElement?.blur();
  }

  // Priority, topic and who's assigned are for the team, so they
  // aren't shown here
  const details = [
    ["Status", <PortalStatusBadge key="s" status={ticket.status} />],
    ["Request", `#${ticket.id}`],
    ["Sent", formatDate(ticket.createdAt)],
    ["Last update", timeAgo(ticket.updatedAt)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/portal"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" />
          My requests
        </Link>
        <p className="mt-3 text-sm text-muted">Request #{ticket.id}</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
          {ticket.subject}
        </h1>
      </div>

      {state?.created && (
        <p className="flex items-start gap-3 rounded-xl bg-brand/10 px-4 py-3 text-sm text-brand">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Thanks, we've got your request. You'll see our replies here.
        </p>
      )}
      {ticket.status === "waiting" && (
        <p className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <MessageCircleReply className="mt-0.5 h-4 w-4 shrink-0" />
          We're waiting for your reply before we can carry on.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* Details: on the right on big screens, on top on phones */}
        <aside className="flex h-fit flex-col gap-4 lg:order-last">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-white p-5 text-sm lg:grid-cols-1">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {!done && (
            <button
              type="button"
              onClick={() => updateTicket(ticket.id, { status: "resolved" })}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
            >
              <CircleCheck className="h-4 w-4" />
              My issue is fixed
            </button>
          )}
        </aside>

        {/* Conversation */}
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-5">
            {conversation.map((m) => (
              <Bubble key={m.id} message={m} mine={m.kind === "customer"} />
            ))}
          </ul>

          {done && <Rating ticket={ticket} />}

          {closed ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-white p-6 text-center">
              <Lock className="h-5 w-5 text-muted" />
              <p className="text-sm text-muted">
                This request is closed. Need more help? Send us a new one.
              </p>
              <Link
                to="/portal/new"
                className="flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
              >
                New request
              </Link>
            </div>
          ) : (
            <form
              onSubmit={sendReply}
              className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4"
            >
              <textarea
                rows={4}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  ticket.status === "resolved"
                    ? "Still not working? Reply here and we'll pick it back up."
                    : "Write a reply…"
                }
                className={`${inputClass} h-auto resize-y py-2.5`}
              />
              <div className="grid sm:flex sm:justify-end">
                <button
                  type="submit"
                  disabled={!reply.trim()}
                  className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Send reply
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
