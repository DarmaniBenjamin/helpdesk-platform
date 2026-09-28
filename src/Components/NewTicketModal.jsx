import { useState } from "react";
import { useNavigate } from "react-router";
import { CircleCheck } from "lucide-react";
import Modal from "./Modal";
import CustomerPicker from "./CustomerPicker";
import CustomerFields from "./CustomerFields";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { SLA_HOURS, PRIORITIES, DEPARTMENTS, HOUR } from "../data";
import useData from "../useData";

// Turns a time into the format a date-time input expects, e.g. "2026-09-24T17:30"
function toInputValue(time) {
  const date = new Date(time);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

// Default due time for a priority, from its SLA (e.g. Urgent = 4 hours from now)
function defaultDue(priority) {
  return toInputValue(Date.now() + SLA_HOURS[priority].resolve * HOUR);
}

const blankCustomer = { name: "", email: "", phone: "", company: "" };

// This component is only drawn while the form is open, so every time it
// opens, all of these start fresh (fresh due time, nothing selected, etc.)
export default function NewTicketModal({ onClose }) {
  const navigate = useNavigate();
  const { customers, addCustomer, addTicket, findCustomerByEmail } = useData();
  const [priority, setPriority] = useState(2);
  const [dueBy, setDueBy] = useState(() => defaultDue(2));
  const [dueEdited, setDueEdited] = useState(false);
  const [earliestDue] = useState(() => toInputValue(Date.now())); // can't pick a time in the past

  // Customer: pick an existing one, or type in a new one
  const [customerMode, setCustomerMode] = useState("existing");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState(blankCustomer);
  const [customerError, setCustomerError] = useState("");
  const [duplicate, setDuplicate] = useState(null); // existing customer with the same email

  // After submitting: the new ticket, and whether the customer was new
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const businesses = [
    ...new Set(customers.map((c) => c.company).filter(Boolean)),
  ].sort();

  function choosePriority(value) {
    setPriority(value);
    if (!dueEdited) setDueBy(defaultDue(value));
  }

  function switchMode(mode) {
    setCustomerMode(mode);
    setCustomerError("");
    setDuplicate(null);
  }

  function pickDuplicate() {
    setSelectedCustomer(duplicate);
    switchMode("existing");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setCustomerError("");
    setDuplicate(null);
    // Read the form now: after waiting for the server it may be gone
    const form = new FormData(e.currentTarget);

    let customer;
    let isNew = false;

    if (customerMode === "existing") {
      if (!selectedCustomer) {
        setCustomerError("Pick a customer, or switch to New customer.");
        return;
      }
      customer = selectedCustomer;
    } else {
      const existing = findCustomerByEmail(newCustomer.email);
      if (existing) {
        setDuplicate(existing);
        return;
      }
      // A new customer is saved to the database first
      setBusy(true);
      try {
        customer = await addCustomer(newCustomer);
      } catch (err) {
        setCustomerError(err.message);
        setBusy(false);
        return;
      }
      isNew = true;
    }

    // Then the ticket, using the form fields' "name"s
    setBusy(true);
    try {
      const ticket = await addTicket({
        customer,
        subject: form.get("subject").trim(),
        department: form.get("department"),
        description: form.get("description").trim(),
        priority,
        dueBy: new Date(dueBy).getTime(),
      });
      document.activeElement?.blur();
      setResult({ ticket, isNew });
    } catch (err) {
      setCustomerError(err.message);
      setBusy(false);
    }
  }

  function viewInInbox() {
    onClose();
    navigate("/inbox");
  }

  function handleDone() {
    onClose();
    // Back to the top of the page, like a fresh load
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ----- After submitting -----
  if (result) {
    return (
      <Modal
        title="Ticket created"
        onClose={handleDone}
        footer={
          <>
            <button
              type="button"
              onClick={handleDone}
              className={secondaryButton}
            >
              Done
            </button>
            <button
              type="button"
              onClick={viewInInbox}
              className={primaryButton}
            >
              View in Inbox
            </button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="h-12 w-12 text-brand" />
          <p className="text-sm">
            Ticket <span className="font-semibold">#{result.ticket.id}</span>{" "}
            created for{" "}
            <span className="font-semibold">
              {result.ticket.requester.name}
            </span>
            .
          </p>
          {result.isNew && (
            <p className="text-sm text-muted">
              They were also added to your customers.
            </p>
          )}
          <p className="text-xs text-muted">
            It's now at the top of your Inbox.
          </p>
        </div>
      </Modal>
    );
  }

  // ----- The form -----
  return (
    <Modal
      title="New ticket"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`${primaryButton} disabled:cursor-wait disabled:opacity-70`}
          >
            {busy ? "Saving…" : "Create ticket"}
          </button>
        </>
      }
    >
      {/* Customer */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Customer</span>
          <div className="flex rounded-lg bg-page p-1 text-sm">
            {[
              { mode: "existing", label: "Existing" },
              { mode: "new", label: "New customer" },
            ].map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => switchMode(option.mode)}
                className={`cursor-pointer rounded-md px-3 py-1.5 transition active:scale-[0.97] ${
                  customerMode === option.mode
                    ? "bg-white font-medium text-brand shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {customerMode === "existing" ? (
          <CustomerPicker
            customers={customers}
            selected={selectedCustomer}
            onSelect={(customer) => {
              setSelectedCustomer(customer);
              setCustomerError("");
            }}
          />
        ) : (
          <CustomerFields
            value={newCustomer}
            onChange={setNewCustomer}
            businesses={businesses}
            emailError={
              duplicate ? `${duplicate.name} already uses this email.` : ""
            }
          />
        )}

        {duplicate && (
          <button
            type="button"
            onClick={pickDuplicate}
            className="cursor-pointer self-start text-sm font-medium text-brand hover:underline"
          >
            Use {duplicate.name} instead
          </button>
        )}
        {customerError && (
          <p className="text-sm text-red-500">{customerError}</p>
        )}
      </div>

      <hr className="border-line" />

      {/* Ticket */}
      <label className={labelClass}>
        Subject
        <input
          name="subject"
          required
          placeholder="Short summary of the issue"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Department
        <select name="department" className={`${inputClass} cursor-pointer`}>
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <div className={labelClass}>
        Priority
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(PRIORITIES).map(([value, { label }]) => (
            <button
              key={value}
              type="button"
              onClick={() => choosePriority(Number(value))}
              className={`h-10 cursor-pointer rounded-lg border text-sm transition active:scale-[0.97] ${
                priority === Number(value)
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
        Due by
        <input
          type="datetime-local"
          required
          value={dueBy}
          min={earliestDue}
          onChange={(e) => {
            setDueBy(e.target.value);
            setDueEdited(true);
          }}
          className={`${inputClass} block cursor-pointer appearance-none text-left`}
        />
        <span className="text-xs font-normal text-muted">
          {dueEdited
            ? "Custom due time."
            : `Set from the priority: ${PRIORITIES[priority].label} tickets are due within ${SLA_HOURS[priority].resolve} hours.`}
        </span>
      </label>

      <label className={labelClass}>
        Description
        <textarea
          name="description"
          required
          rows={4}
          placeholder="What's happening?"
          className={`${inputClass} h-auto shrink-0 py-2.5`}
        />
      </label>
    </Modal>
  );
}
