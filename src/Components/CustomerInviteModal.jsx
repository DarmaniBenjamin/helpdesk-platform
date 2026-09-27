import { useState } from "react";
import { Check, CircleCheck, Copy, Eye, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import CustomerPicker from "./CustomerPicker";
import { primaryButton, secondaryButton } from "./formStyles";
import { copyText, inviteLinkFor } from "./copyText";
import useData from "../useData";

// Give one of your customers access to the customer portal.
// They can only ever see their own tickets.
export default function CustomerInviteModal({ onClose }) {
  const { customers, team, inviteCustomer, findMemberByEmail } = useData();
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // After inviting, show a "done" screen with their link
  const [invited, setInvited] = useState(null); // { member, link }
  const [copied, setCopied] = useState(false);

  // Customers who don't have portal access (or an invite) yet
  const withAccess = new Set(
    team.filter((m) => m.customerId).map((m) => m.customerId),
  );
  const available = customers.filter((c) => !withAccess.has(c.id));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selected) {
      setError("Pick a customer first.");
      return;
    }
    // Their email can't already belong to someone on your staff
    if (findMemberByEmail(selected.email)) {
      setError("Someone on your team already signs in with this email.");
      return;
    }
    setBusy(true);
    try {
      const result = await inviteCustomer(selected.id);
      document.activeElement?.blur();
      setInvited({ member: result.member, link: inviteLinkFor(result.token) });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // ----- The "invite ready" screen -----
  if (invited) {
    return (
      <Modal
        title="Invite ready"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose} className={primaryButton}>
            Done
          </button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CircleCheck className="h-12 w-12 text-brand" />
          <p className="text-sm">
            <span className="font-semibold">{invited.member.name}</span> was
            invited to the customer portal.
          </p>
          <p className="text-sm text-muted">
            Invite emails aren't set up yet, so send them this link yourself. It
            works once, for 7 days. They'll sign in with{" "}
            <span className="font-medium text-ink">{invited.member.email}</span>
            .
          </p>
        </div>

        {/* The invite link, with a copy button */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-page p-2">
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted">
            {invited.link}
          </span>
          <button
            type="button"
            onClick={async () => {
              if (await copyText(invited.link, "Copy this invite link:")) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <p className="text-center text-xs text-muted">
          They'll only be able to see their own tickets.
        </p>
      </Modal>
    );
  }

  // ----- The form -----
  return (
    <Modal
      title="Invite customer"
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
            {busy ? "Saving…" : "Create invite"}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3 rounded-lg bg-page p-3 text-sm">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <p className="text-muted">
          Customers can sign in to see and follow{" "}
          <span className="font-medium text-ink">only their own tickets</span>.
          They never see other customers, internal notes or your settings.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Customer</p>
        <CustomerPicker
          customers={available}
          selected={selected}
          onSelect={(customer) => {
            setSelected(customer);
            setError("");
          }}
          emptyText="No customers match, or they already have access. Add new customers on the Customers page."
        />
        {error && (
          <span className="flex items-start gap-1.5 text-xs text-red-500">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </span>
        )}
        {selected && !error && (
          <span className="text-xs text-muted">
            They'll sign in with their main email.
          </span>
        )}
      </div>
    </Modal>
  );
}
