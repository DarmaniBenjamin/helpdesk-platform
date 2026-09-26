import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, Check } from "lucide-react";
import { inputClass, labelClass } from "../formStyles";
import { DEPARTMENTS, HOUR, SLA_HOURS } from "../../data";
import useData from "../../useData";

// How urgent it is, in the customer's words. These set the ticket's priority.
const URGENCY = [
  { priority: 1, label: "Low", hint: "No rush, it can wait a few days" },
  { priority: 2, label: "Medium", hint: "It's getting in the way of my work" },
  { priority: 3, label: "High", hint: "I can't work until it's fixed" },
  { priority: 4, label: "Urgent", hint: "The whole office is affected" },
];

// The customer sends a new request. It becomes a ticket in the Inbox,
// marked as coming from the customer portal.
export default function PortalNewRequest() {
  const { me, customers, addTicket } = useData();
  const navigate = useNavigate();

  const [subject, setSubject] = useState("");
  const [department, setDepartment] = useState(DEPARTMENTS[0].id);
  const [priority, setPriority] = useState(2);
  const [description, setDescription] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const customer = customers.find((c) => c.id === me.customerId);
    const ticket = addTicket({
      customer,
      subject: subject.trim(),
      department,
      priority,
      dueBy: Date.now() + SLA_HOURS[priority].resolve * HOUR,
      description: description.trim(),
      source: "portal",
    });
    navigate(`/portal/tickets/${ticket.id}`, { state: { created: true } });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          to="/portal"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" />
          My requests
        </Link>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">New request</h1>
        <p className="mt-1 text-sm text-muted">
          Tell us what's going on and we'll get back to you.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-xl border border-line bg-white p-5 sm:p-6"
      >
        <label className={labelClass}>
          What do you need help with?
          <input
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Printer won't print"
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          What's it about?
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">
            How urgent is it?
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {URGENCY.map((u) => {
              const selected = priority === u.priority;
              return (
                <label
                  key={u.priority}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition active:scale-[0.99] ${
                    selected
                      ? "border-brand bg-brand/5"
                      : "border-line hover:border-brand/30 hover:bg-brand/5"
                  }`}
                >
                  <input
                    type="radio"
                    name="urgency"
                    checked={selected}
                    onChange={() => setPriority(u.priority)}
                    className="sr-only"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{u.label}</span>
                    <span className="block text-xs text-muted">{u.hint}</span>
                  </span>
                  {selected && (
                    <Check className="h-4 w-4 shrink-0 text-brand" />
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className={labelClass}>
          Tell us more
          <textarea
            required
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened, when it started, and anything you've already tried."
            className={`${inputClass} h-auto resize-y py-2.5`}
          />
        </label>

        <div className="grid gap-2 border-t border-line pt-5 sm:flex sm:justify-end">
          <Link
            to="/portal"
            className="flex h-11 items-center justify-center rounded-lg border border-line px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="order-first h-11 cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:order-last"
          >
            Send request
          </button>
        </div>
      </form>
    </div>
  );
}
