import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, PhoneCall } from "lucide-react";
import { inputClass, labelClass } from "../formStyles";
import useData from "../../useData";

// Every request comes in with no team and nobody assigned (the server
// sets that, with Medium priority), and lands in the Inbox's
// "Unassigned" tab. The admin picks the team, priority and person (or a
// tech takes it), so the customer never has to choose.

// The customer describes their problem in their own words. It becomes a
// ticket in the Inbox, marked as coming from the customer portal.
export default function PortalNewRequest() {
  const { addTicket } = useData();
  const navigate = useNavigate();

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const ticket = await addTicket({
        subject: subject.trim(),
        description: description.trim(),
      });
      navigate(`/portal/tickets/${ticket.id}`, { state: { created: true } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
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
          Tell us more
          <textarea
            required
            rows={7}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened, when it started, and anything you've already tried."
            className={`${inputClass} h-auto resize-y py-2.5`}
          />
        </label>

        <p className="flex items-start gap-3 rounded-lg bg-page p-3 text-sm text-muted">
          <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          Our team will look at your request and pass it to the right person. If
          someone needs to come by, we'll call you to set up a time.
        </p>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="grid gap-2 border-t border-line pt-5 sm:flex sm:justify-end">
          <Link
            to="/portal"
            className="flex h-11 items-center justify-center rounded-lg border border-line px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="order-first h-11 cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:order-last"
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </div>
  );
}
