import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Search,
  UserPlus,
  Building2,
  Mail,
  Phone,
  UserRound,
} from "lucide-react";
import Avatar from "../Avatar";
import NewCustomerModal from "../NewCustomerModal";
import { inputClass } from "../formStyles";
import { isDone } from "../../data";
import useData from "../../useData";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "business", label: "Businesses" },
  { id: "individual", label: "Individuals" },
];

// Stops a click on an email/phone link from also opening the customer
const stop = (e) => e.stopPropagation();

function BusinessLabel({ company }) {
  return company ? (
    <span className="inline-flex items-center gap-1.5">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted" />
      {company}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <UserRound className="h-3.5 w-3.5 shrink-0" />
      Individual
    </span>
  );
}

export default function Customers() {
  const { tickets, customers } = useData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);

  // Count each customer's tickets: { 1001: { total: 5, open: 1 }, ... }
  const ticketCounts = {};
  for (const t of tickets) {
    const counts = (ticketCounts[t.customerId] ??= { total: 0, open: 0 });
    counts.total += 1;
    if (!isDone(t)) counts.open += 1;
  }

  const text = query.trim().toLowerCase();
  const shown = customers
    .filter(
      (c) =>
        filter === "all" || (filter === "business" ? c.company : !c.company),
    )
    .filter(
      (c) =>
        !text ||
        [c.name, c.email, c.phone, c.company ?? ""].some((f) =>
          f.toLowerCase().includes(text),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const businessCount = new Set(customers.map((c) => c.company).filter(Boolean))
    .size;
  const openCustomer = (c) => navigate(`/customers/${c.id}`);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Customers</h1>
          <p className="mt-1 text-sm text-muted">
            {customers.length} customers across {businessCount} businesses
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:w-auto"
        >
          <UserPlus className="h-4 w-4" />
          Add customer
        </button>
      </div>

      {/* Search and filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers"
            className={`${inputClass} pl-9`}
          />
        </div>
        <div className="flex rounded-lg border border-line bg-white p-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 transition active:scale-[0.97] sm:flex-none ${
                filter === f.id
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-line bg-white px-6 py-12 text-center text-sm text-muted">
          No customers match your search.
        </div>
      ) : (
        <>
          {/* Desktop and tablet: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-200 text-left text-sm">
              <thead>
                <tr className="whitespace-nowrap border-b border-line text-muted">
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Phone</th>
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-5 py-3 font-medium">Tickets</th>
                  <th className="px-5 py-3 font-medium">Customer since</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const counts = ticketCounts[c.id] ?? { total: 0, open: 0 };
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openCustomer(c)}
                      className="cursor-pointer border-b border-line transition last:border-0 hover:bg-page active:bg-brand/5"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <p className="font-medium">{c.name}</p>
                            <a
                              href={`mailto:${c.email}`}
                              onClick={stop}
                              className="text-xs text-muted hover:text-brand"
                            >
                              {c.email}
                            </a>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        {c.phone ? (
                          <a
                            href={`tel:${c.phone}`}
                            onClick={stop}
                            className="hover:text-brand"
                          >
                            {c.phone}
                          </a>
                        ) : (
                          <span className="text-muted">None</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <BusinessLabel company={c.company} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        {counts.total}
                        {counts.open > 0 && (
                          <span className="ml-2 text-xs font-medium text-brand">
                            {counts.open} open
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">
                        {new Date(c.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {shown.map((c) => {
              const counts = ticketCounts[c.id] ?? { total: 0, open: 0 };
              return (
                <li key={c.id}>
                  <div
                    onClick={() => openCustomer(c)}
                    className="cursor-pointer rounded-xl border border-line bg-white p-4 transition active:scale-[0.99] active:bg-brand/5"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={c.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="truncate text-sm">
                          <BusinessLabel company={c.company} />
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted">
                        {counts.total} ticket{counts.total === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-sm">
                      <a
                        href={`mailto:${c.email}`}
                        onClick={stop}
                        className="flex items-center gap-2 text-muted"
                      >
                        <Mail className="h-4 w-4 shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </a>
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          onClick={stop}
                          className="flex items-center gap-2 text-muted"
                        >
                          <Phone className="h-4 w-4 shrink-0" />
                          {c.phone}
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {adding && <NewCustomerModal onClose={() => setAdding(false)} />}
    </div>
  );
}
