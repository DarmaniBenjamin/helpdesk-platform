import { useEffect, useState } from "react";
import { ExternalLink, Receipt, TriangleAlert } from "lucide-react";
import { api } from "../api";
import useData from "../useData";

// The ticket's QuickBooks invoice (server/src/quickbooks.js), on the
// ticket page. Admins choose whether it's billed; once it's closed, a
// draft invoice is made in QuickBooks, shown here with its number, what's
// owed, and a link to open it there.
export default function TicketInvoice({ ticket }) {
  const { me, updateTicket } = useData();
  const isAdmin = me.role === "owner" || me.role === "admin";
  // Is QuickBooks connected? (Admins can see; agents only see invoices)
  const [connected, setConnected] = useState(null);
  const [loaded, setLoaded] = useState(null); // { number, total, balance, paid, emailed, link }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    api("/quickbooks")
      .then((q) => setConnected(q.connected))
      .catch(() => setConnected(false));
  }, [isAdmin]);

  // The invoice's latest numbers, once there is one
  const number = ticket.invoice?.number;
  useEffect(() => {
    if (!number) return;
    let current = true;
    api(`/tickets/${ticket.id}/quickbooks`)
      .then((r) => current && setLoaded(r.invoice))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [ticket.id, number]);

  // (only the numbers of this ticket's current invoice)
  const details = number && loaded?.number === number ? loaded : null;

  // Nothing to show: not billed, and QuickBooks isn't set up (or the
  // person can't change it)
  if (!ticket.billInQuickbooks && !ticket.invoice && !(isAdmin && connected))
    return null;

  async function setBilled(on) {
    setBusy("flag");
    setError("");
    try {
      await updateTicket(ticket.id, { billInQuickbooks: on });
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  async function makeNow() {
    setBusy("make");
    setError("");
    try {
      await api(`/tickets/${ticket.id}/quickbooks`, { method: "POST" });
      // Load the ticket again (it now has the invoice number)
      await updateTicket(ticket.id, {});
    } catch (err) {
      setError(err.message);
      await updateTicket(ticket.id, {}).catch(() => {});
    }
    setBusy("");
  }

  const money = (n) =>
    typeof n === "number"
      ? n.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
  const stateText = !details
    ? ""
    : details.paid
      ? "Paid"
      : details.total === 0
        ? "Draft: add the hours and prices in QuickBooks, then send it"
        : details.emailed
          ? `Sent, ${money(details.balance)} still owed`
          : `${money(details.total)}, not sent yet`;

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="mb-2 flex items-center gap-2 font-semibold">
        <Receipt className="h-4 w-4 text-emerald-600" />
        QuickBooks
      </p>

      {isAdmin && !ticket.invoice?.number && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ticket.billInQuickbooks}
            disabled={busy === "flag"}
            onChange={(e) => setBilled(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
          />
          <span>Bill in QuickBooks</span>
        </label>
      )}

      {ticket.invoice?.number ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <p>
            Invoice <span className="font-medium">{ticket.invoice.number}</span>
          </p>
          {stateText && (
            <p
              className={`text-xs ${details?.paid ? "font-medium text-brand" : "text-muted"}`}
            >
              {stateText}
            </p>
          )}
          {details?.link && (
            <a
              href={details.link}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline"
            >
              Open in QuickBooks
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      ) : ticket.invoice?.error ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-600">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The draft invoice wasn't made: {ticket.invoice.error}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={makeNow}
              disabled={busy === "make"}
              className="w-fit cursor-pointer text-sm font-medium text-brand hover:underline disabled:opacity-50"
            >
              {busy === "make" ? "Trying…" : "Try again"}
            </button>
          )}
        </div>
      ) : ticket.billInQuickbooks ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <p className="text-xs text-muted">
            {ticket.status === "closed"
              ? "Closed: the draft invoice is being made (within a minute or two)."
              : "A draft invoice is made in QuickBooks when the ticket is closed."}
          </p>
          {isAdmin && connected && (
            <button
              type="button"
              onClick={makeNow}
              disabled={busy === "make"}
              className="w-fit cursor-pointer text-sm font-medium text-brand hover:underline disabled:opacity-50"
            >
              {busy === "make" ? "Making it…" : "Make the draft invoice now"}
            </button>
          )}
        </div>
      ) : null}

      {error && error !== ticket.invoice?.error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
