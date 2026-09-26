import { useState } from "react";
import { CircleCheck, Eye } from "lucide-react";
import Modal from "./Modal";
import CustomerPicker from "./CustomerPicker";
import { primaryButton, secondaryButton } from "./formStyles";
import useData from "../useData";

// Give one of your customers access to the customer portal.
// They can only ever see their own tickets.
export default function CustomerInviteModal({ onClose }) {
  const { customers, team, inviteCustomer, findMemberByEmail } = useData();
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  // After inviting, show a "done" screen instead of the form
  const [invited, setInvited] = useState(null);

  // Customers who don't have portal access (or an invite) yet
  const withAccess = new Set(
    team.filter((m) => m.customerId).map((m) => m.customerId),
  );
  const available = customers.filter((c) => !withAccess.has(c.id));

  function handleSubmit(e) {
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
    document.activeElement?.blur();
    setInvited(inviteCustomer(selected));
  }

  // ----- The "invite sent" screen -----
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
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="h-12 w-12 text-brand" />
          <p className="text-sm">
            <span className="font-semibold">{invited.name}</span> was invited to
            the customer portal.
          </p>
          <p className="text-sm text-muted">
            Once email is connected, they'll get a link at{" "}
            <span className="font-medium text-ink">{invited.email}</span> to set
            their password.
          </p>
          <p className="text-xs text-muted">
            They'll only be able to see their own tickets.
          </p>
        </div>
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
          <button type="submit" className={primaryButton}>
            Send invite
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
        {error && <span className="text-xs text-red-500">{error}</span>}
        {selected && (
          <span className="text-xs text-muted">
            The invite goes to their main email.
          </span>
        )}
      </div>
    </Modal>
  );
}
