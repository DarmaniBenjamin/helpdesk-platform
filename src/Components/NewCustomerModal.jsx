import { useState } from "react";
import Modal from "./Modal";
import CustomerFields from "./CustomerFields";
import { primaryButton, secondaryButton } from "./formStyles";
import useData from "../useData";

export default function NewCustomerModal({ onClose }) {
  const { customers, addCustomer, findCustomerByEmail } = useData();
  const [fields, setFields] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
  });
  const [emailError, setEmailError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);

  const businesses = [
    ...new Set(customers.map((c) => c.company).filter(Boolean)),
  ].sort();

  async function handleSubmit(e) {
    e.preventDefault();
    setSaveError("");
    const existing = findCustomerByEmail(fields.email);
    if (existing) {
      setEmailError(`${existing.name} already uses this email.`);
      return;
    }
    setBusy(true);
    try {
      await addCustomer(fields); // saves to the database
      document.activeElement?.blur();
      onClose();
    } catch (err) {
      if (err.status === 409) setEmailError(err.message);
      else setSaveError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New customer"
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
            {busy ? "Saving…" : "Add customer"}
          </button>
        </>
      }
    >
      <CustomerFields
        value={fields}
        onChange={(next) => {
          setFields(next);
          setEmailError("");
        }}
        businesses={businesses}
        emailError={emailError}
      />
      {saveError && <p className="text-sm text-red-500">{saveError}</p>}
    </Modal>
  );
}
