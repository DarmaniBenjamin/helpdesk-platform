import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  UserRound,
  Pencil,
  Plus,
  Trash2,
  Star,
  UserX,
  Check,
  X,
  TriangleAlert,
} from "lucide-react";
import Avatar from "../Avatar";
import Modal from "../Modal";
import StatusBadge from "../StatusBadge";
import DueLabel from "../DueLabel";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "../formStyles";
import { can } from "../teamRoles";
import useData from "../../useData";
import { isDone, isOverdue, timeAgo } from "../../data";

// A list of emails or phone numbers: the main one first, then any extras.
// Every one can be changed or removed (removing asks first), an extra
// can be made the main one, and more can be added.
function ContactList({
  title,
  icon,
  type,
  main,
  extras,
  hrefPrefix,
  onAdd,
  onEdit,
  onRemove,
  onMakeMain,
  validate,
}) {
  const Icon = icon;
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // the one being changed
  const [removing, setRemoving] = useState(null); // "are you sure?" on this one

  const all = [main, ...extras].filter(Boolean);

  function startAdding() {
    setEditing(null);
    setRemoving(null);
    setValue("");
    setError("");
    setAdding(true);
  }

  function startEditing(item) {
    setAdding(false);
    setRemoving(null);
    setValue(item);
    setError("");
    setEditing(item);
  }

  function cancel() {
    setAdding(false);
    setEditing(null);
    setValue("");
    setError("");
  }

  async function handleSave(e) {
    e.preventDefault();
    const clean = value.trim();
    if (editing !== null && clean === editing) return cancel();
    const problem = validate(clean, editing);
    if (problem) {
      setError(problem);
      return;
    }
    const ok =
      editing !== null ? await onEdit(editing, clean) : await onAdd(clean);
    if (ok === false) return; // the page shows why
    cancel();
  }

  // The box for adding a new one or changing one
  const editor = (
    <form onSubmit={handleSave} className="flex flex-col gap-2 py-2">
      <div className="flex gap-2">
        <input
          autoFocus
          type={type === "email" ? "email" : "tel"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          placeholder={
            type === "email" ? "another@email.com" : "+1 (473) 555-0100"
          }
          className={`${inputClass} ${error ? "border-red-400" : ""}`}
        />
        <button
          type="submit"
          aria-label="Save"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand/90 active:scale-[0.95]"
        >
          <Check className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={cancel}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition hover:text-ink active:scale-[0.95]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );

  const iconButton =
    "cursor-pointer rounded-lg p-2 text-muted transition active:scale-[0.92]";

  return (
    <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {!adding && (
          <button
            type="button"
            onClick={startAdding}
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-brand transition hover:bg-brand/10 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        )}
      </div>

      {all.length === 0 && !adding && (
        <p className="text-sm text-muted">None added yet.</p>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {all.map((item) => {
          const isMain = item === main;
          if (editing === item) return <li key={item}>{editor}</li>;
          if (removing === item)
            return (
              <li
                key={item}
                className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center"
              >
                <p className="min-w-0 flex-1">
                  Remove <strong className="break-all">{item}</strong>?
                  {isMain &&
                    extras.length > 0 &&
                    ` ${extras[0]} becomes the main one.`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRemoving(null)}
                    className="h-9 flex-1 cursor-pointer rounded-lg border border-line px-3 transition hover:bg-page sm:flex-none"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await onRemove(item);
                      if (ok !== false) setRemoving(null);
                    }}
                    className="h-9 flex-1 cursor-pointer rounded-lg bg-red-500 px-3 font-medium text-white transition hover:bg-red-600 active:scale-[0.97] sm:flex-none"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          return (
            <li key={item} className="flex items-center gap-2 py-2">
              <Icon className="h-4 w-4 shrink-0 text-muted" />
              <a
                href={`${hrefPrefix}${item}`}
                className="min-w-0 flex-1 truncate text-sm hover:text-brand"
              >
                {item}
              </a>
              {isMain && (
                <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                  Main
                </span>
              )}
              <div className="flex shrink-0 items-center">
                {!isMain && (
                  <button
                    type="button"
                    onClick={() => onMakeMain(item)}
                    title="Make this the main one"
                    aria-label={`Make ${item} the main ${type}`}
                    className={`${iconButton} hover:bg-brand/10 hover:text-brand`}
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => startEditing(item)}
                  title="Change"
                  aria-label={`Change ${item}`}
                  className={`${iconButton} hover:bg-brand/10 hover:text-brand`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cancel();
                    setRemoving(item);
                  }}
                  title="Remove"
                  aria-label={`Remove ${item}`}
                  className={`${iconButton} hover:bg-red-50 hover:text-red-500`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {adding && <div className="mt-1">{editor}</div>}
    </div>
  );
}

// "Are you sure?" before deleting a customer. Their tickets go too, so
// their name has to be typed in first.
function DeleteCustomerModal({ customer, ticketCount, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches =
    typed.trim().toLowerCase() === customer.name.trim().toLowerCase();

  async function handleDelete(e) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Delete this customer?"
      onClose={onClose}
      onSubmit={handleDelete}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Keep them
          </button>
          <button
            type="submit"
            disabled={!matches || busy}
            className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {busy ? "Deleting…" : "Delete for good"}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-page p-3 text-sm">
        <Avatar name={customer.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium">{customer.name}</p>
          <p className="truncate text-muted">
            {customer.company ?? "Individual"}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This deletes the customer
          {ticketCount > 0 && (
            <>
              {" "}
              and <strong>all {ticketCount} of their tickets</strong>, with
              every reply, note and attached file
            </>
          )}
          . If they can sign in to the customer portal, that stops too.{" "}
          <strong>It can't be undone.</strong>
        </p>
      </div>

      <label className={labelClass}>
        <span>
          Type <strong>{customer.name}</strong> to confirm
        </span>
        <input
          autoFocus
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setError("");
          }}
          placeholder={customer.name}
          className={inputClass}
        />
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    me,
    tickets,
    customers,
    updateCustomer,
    deleteCustomer,
    findCustomerByEmail,
  } = useData();

  const customer = customers.find((c) => c.id === Number(id));

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  // A message if saving to the database didn't work
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false); // the "are you sure?" box

  if (!customer) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <UserX className="h-10 w-10 text-muted" />
        <h1 className="text-xl font-semibold">This customer doesn't exist</h1>
        <Link
          to="/customers"
          className="text-sm font-medium text-brand hover:underline"
        >
          Back to Customers
        </Link>
      </div>
    );
  }

  const extraEmails = customer.extraEmails ?? [];
  const extraPhones = customer.extraPhones ?? [];
  const businesses = [
    ...new Set(customers.map((c) => c.company).filter(Boolean)),
  ].sort();

  const theirTickets = tickets.filter((t) => t.customerId === customer.id); // already newest first
  const openCount = theirTickets.filter((t) => !isDone(t)).length;
  const overdueCount = theirTickets.filter(isOverdue).length;

  // Saves changes to the database. Returns true if it worked; if not,
  // the server's message shows at the top of the page.
  async function save(changes) {
    setSaveError("");
    try {
      await updateCustomer(customer.id, changes);
      return true;
    } catch (err) {
      setSaveError(err.message);
      return false;
    }
  }

  function startEditing() {
    setName(customer.name);
    setCompany(customer.company ?? "");
    setEditing(true);
  }

  async function saveDetails(e) {
    e.preventDefault();
    const ok = await save({
      name: name.trim(),
      company: company.trim() || null,
    });
    if (!ok) return;
    document.activeElement?.blur();
    setEditing(false);
  }

  function goBack() {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/customers");
  }

  // ----- Emails -----
  // `current`: the one being changed (it can keep its own address)
  function validateEmail(email, current) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return "That doesn't look like an email address.";
    const owner = findCustomerByEmail(email);
    if (owner?.id === customer.id && email.toLowerCase() !== current)
      return "This customer already has that email.";
    if (owner && owner.id !== customer.id)
      return `${owner.name} already uses this email.`;
    return "";
  }
  function addEmail(email) {
    const clean = email.toLowerCase();
    if (!customer.email) return save({ email: clean });
    return save({ extraEmails: [...extraEmails, clean] });
  }
  function editEmail(old, email) {
    const clean = email.toLowerCase();
    if (old === customer.email) return save({ email: clean });
    return save({
      extraEmails: extraEmails.map((e) => (e === old ? clean : e)),
    });
  }
  function removeEmail(email) {
    // Removing the main one: the next one (if any) becomes the main one
    if (email === customer.email)
      return save({
        email: extraEmails[0] ?? null,
        extraEmails: extraEmails.slice(1),
      });
    return save({ extraEmails: extraEmails.filter((e) => e !== email) });
  }
  function makeMainEmail(email) {
    // The old main email becomes an extra one
    return save({
      email,
      extraEmails: [customer.email, ...extraEmails.filter((e) => e !== email)],
    });
  }

  // ----- Phones -----
  function validatePhone(phone, current) {
    if (phone.replace(/\D/g, "").length < 7)
      return "Enter a full phone number.";
    if (
      phone !== current &&
      (phone === customer.phone || extraPhones.includes(phone))
    )
      return "This customer already has that number.";
    return "";
  }
  function addPhone(phone) {
    if (!customer.phone) return save({ phone });
    return save({ extraPhones: [...extraPhones, phone] });
  }
  function editPhone(old, phone) {
    if (old === customer.phone) return save({ phone });
    return save({
      extraPhones: extraPhones.map((p) => (p === old ? phone : p)),
    });
  }
  function removePhone(phone) {
    if (phone === customer.phone)
      return save({
        phone: extraPhones[0] ?? "",
        extraPhones: extraPhones.slice(1),
      });
    return save({ extraPhones: extraPhones.filter((p) => p !== phone) });
  }
  function makeMainPhone(phone) {
    return save({
      phone,
      extraPhones: [
        customer.phone,
        ...extraPhones.filter((p) => p !== phone),
      ].filter(Boolean),
    });
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <button
        type="button"
        onClick={goBack}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted transition hover:text-brand"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      {saveError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {saveError}
        </p>
      )}

      {/* Name, business, and quick numbers */}
      <div className="rounded-xl border border-line bg-white p-4 sm:p-6">
        {editing ? (
          <form onSubmit={saveDetails} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Full name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                <span>
                  Business{" "}
                  <span className="font-normal text-muted">
                    (empty for an individual)
                  </span>
                </span>
                <input
                  list="business-list"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={inputClass}
                />
                <datalist id="business-list">
                  {businesses.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </label>
            </div>
            <div className="flex gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Avatar name={customer.name} />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold sm:text-2xl">
                  {customer.name}
                </h1>
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  {customer.company ? (
                    <Building2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <UserRound className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {customer.company ?? "Individual"}
                  </span>
                </p>
                <p className="text-xs text-muted">
                  Customer since{" "}
                  {new Date(customer.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startEditing}
                className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97] sm:flex-none"
              >
                <Pencil className="h-4 w-4" />
                Edit details
              </button>
              {/* Admins and the Super Admin only; asks before deleting */}
              {can(me.role, "deleteTickets") && (
                <button
                  type="button"
                  onClick={() => setDeleting(true)}
                  className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm text-red-500 transition hover:bg-red-50 active:scale-[0.97] sm:flex-none"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-5 text-center">
          <div>
            <p className="text-2xl font-semibold">{theirTickets.length}</p>
            <p className="text-xs text-muted">Tickets</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-brand">{openCount}</p>
            <p className="text-xs text-muted">Open</p>
          </div>
          <div>
            <p
              className={`text-2xl font-semibold ${overdueCount ? "text-red-500" : ""}`}
            >
              {overdueCount}
            </p>
            <p className="text-xs text-muted">Overdue</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[20rem_1fr]">
        {/* Contact details */}
        <div className="flex flex-col gap-4">
          <ContactList
            title="Emails"
            icon={Mail}
            type="email"
            main={customer.email}
            extras={extraEmails}
            hrefPrefix="mailto:"
            validate={validateEmail}
            onAdd={addEmail}
            onEdit={editEmail}
            onRemove={removeEmail}
            onMakeMain={makeMainEmail}
          />
          <ContactList
            title="Phone numbers"
            icon={Phone}
            type="phone"
            main={customer.phone}
            extras={extraPhones}
            hrefPrefix="tel:"
            validate={validatePhone}
            onAdd={addPhone}
            onEdit={editPhone}
            onRemove={removePhone}
            onMakeMain={makeMainPhone}
          />
        </div>

        {/* Their tickets */}
        <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">Tickets</h2>
          {theirTickets.length === 0 ? (
            <p className="text-sm text-muted">No tickets yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {theirTickets.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/tickets/${t.id}`}
                    className="-mx-2 flex flex-col gap-2 rounded-lg px-2 py-3 transition hover:bg-page active:bg-brand/5 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <span className="mr-2 text-muted">#{t.id}</span>
                        {t.subject}
                      </p>
                      <p className="text-xs text-muted">
                        Opened {timeAgo(t.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={t.status} />
                      <DueLabel ticket={t} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {deleting && (
        <DeleteCustomerModal
          customer={customer}
          ticketCount={theirTickets.length}
          onConfirm={async () => {
            await deleteCustomer(customer.id);
            navigate("/customers", { replace: true });
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
