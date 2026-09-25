import { useState } from "react";
import Modal from "./Modal";
import CustomerFields from "./CustomerFields";
import { primaryButton, secondaryButton } from "./formStyles";
import useData from "../useData";

export default function NewCustomerModal({ onClose }) {
  const { customers, addCustomer } = useData();
  const [fields, setFields] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
  });
  const [emailError, setEmailError] = useState("");

  const businesses = [
    ...new Set(customers.map((c) => c.company).filter(Boolean)),
  ].sort();

  function handleSubmit(e) {
    e.preventDefault();
    const email = fields.email.trim().toLowerCase();
    const existing = customers.find((c) => c.email === email);
    if (existing) {
      setEmailError(`${existing.name} already uses this email.`);
      return;
    }
    addCustomer(fields);
    document.activeElement?.blur();
    onClose();
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
          <button type="submit" className={primaryButton}>
            Add customer
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
    </Modal>
  );
}
