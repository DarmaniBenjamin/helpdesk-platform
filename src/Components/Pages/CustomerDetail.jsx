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
import StatusBadge from "../StatusBadge";
import DueLabel from "../DueLabel";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "../formStyles";
import useData from "../../useData";
import { isDone, isOverdue, timeAgo } from "../../data";

// A list of emails or phone numbers: the main one first, then any extras.
// You can add more, remove extras, or make an extra the main one.
function ContactList({
  title,
  icon,
  type,
  main,
  extras,
  hrefPrefix,
  onAdd,
  onRemove,
  onMakeMain,
  validate,
}) {
  const Icon = icon;
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const all = [main, ...extras].filter(Boolean);

  function handleAdd(e) {
    e.preventDefault();
    const clean = value.trim();
    const problem = validate(clean);
    if (problem) {
      setError(problem);
      return;
    }
    onAdd(clean);
    setValue("");
    setError("");
    setAdding(false);
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
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
          return (
            <li key={item} className="flex items-center gap-3 py-2.5">
              <Icon className="h-4 w-4 shrink-0 text-muted" />
              <a
                href={`${hrefPrefix}${item}`}
                className="min-w-0 flex-1 truncate text-sm hover:text-brand"
              >
                {item}
              </a>
              {isMain ? (
                <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                  Main
                </span>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMakeMain(item)}
                    title="Make this the main one"
                    aria-label={`Make ${item} the main ${type}`}
                    className="cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92]"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item)}
                    title="Remove"
                    aria-label={`Remove ${item}`}
                    className="cursor-pointer rounded-lg p-2 text-muted transition hover:bg-red-50 hover:text-red-500 active:scale-[0.92]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {adding && (
        <form onSubmit={handleAdd} className="mt-3 flex flex-col gap-2">
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
              onClick={() => {
                setAdding(false);
                setValue("");
                setError("");
              }}
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition hover:text-ink active:scale-[0.95]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </form>
      )}
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tickets, customers, updateCustomer, findCustomerByEmail } = useData();

  const customer = customers.find((c) => c.id === Number(id));

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  // A message if saving to the database didn't work
  const [saveError, setSaveError] = useState("");

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
  function validateEmail(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return "That doesn't look like an email address.";
    const owner = findCustomerByEmail(email);
    if (owner?.id === customer.id)
      return "This customer already has that email.";
    if (owner) return `${owner.name} already uses this email.`;
    return "";
  }
  function addEmail(email) {
    const clean = email.toLowerCase();
    if (!customer.email) save({ email: clean });
    else save({ extraEmails: [...extraEmails, clean] });
  }
  function removeEmail(email) {
    save({
      extraEmails: extraEmails.filter((e) => e !== email),
    });
  }
  function makeMainEmail(email) {
    // The old main email becomes an extra one
    save({
      email,
      extraEmails: [customer.email, ...extraEmails.filter((e) => e !== email)],
    });
  }

  // ----- Phones -----
  function validatePhone(phone) {
    if (phone.replace(/\D/g, "").length < 7)
      return "Enter a full phone number.";
    if (phone === customer.phone || extraPhones.includes(phone))
      return "This customer already has that number.";
    return "";
  }
  function addPhone(phone) {
    if (!customer.phone) save({ phone });
    else save({ extraPhones: [...extraPhones, phone] });
  }
  function removePhone(phone) {
    save({
      extraPhones: extraPhones.filter((p) => p !== phone),
    });
  }
  function makeMainPhone(phone) {
    save({
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
            <button
              type="button"
              onClick={startEditing}
              className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
            >
              <Pencil className="h-4 w-4" />
              Edit details
            </button>
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
    </div>
  );
}
