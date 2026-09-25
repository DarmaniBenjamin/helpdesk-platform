import { useState } from "react";
import { Search, Building2 } from "lucide-react";
import Avatar from "./Avatar";
import { inputClass } from "./formStyles";

// Search your customers and pick one
export default function CustomerPicker({ customers, selected, onSelect }) {
  const [query, setQuery] = useState("");

  // Once picked: show who it is, with a way to change it
  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-brand bg-brand/5 p-3">
        <Avatar name={selected.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{selected.name}</p>
          <p className="truncate text-xs text-muted">{selected.email}</p>
          <p className="truncate text-xs text-muted">
            {selected.company ?? "Individual"}
            {selected.phone && ` · ${selected.phone}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-brand transition hover:bg-brand/10 active:scale-[0.97]"
        >
          Change
        </button>
      </div>
    );
  }

  // Match the search against name, email, phone and business
  const text = query.trim().toLowerCase();
  const matches = (
    text
      ? customers.filter((c) =>
          [c.name, c.email, c.phone, c.company ?? ""].some((field) =>
            field.toLowerCase().includes(text),
          ),
        )
      : [...customers]
  ).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone or business"
          autoComplete="off"
          className={`${inputClass} pl-9`}
        />
      </div>

      <p className="text-xs text-muted">
        {matches.length} customer{matches.length === 1 ? "" : "s"}
        {text ? " found" : ", scroll to see them all"}
      </p>

      {/* Scrollable list: about 5 customers tall, scroll inside for the rest */}
      <ul className="max-h-72 overflow-y-auto rounded-lg border border-line">
        {matches.map((c) => (
          <li key={c.id} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition hover:bg-brand/5 active:bg-brand/10"
            >
              <Avatar name={c.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.name}
                </span>
                <span className="block truncate text-xs text-muted">
                  {c.email}
                </span>
              </span>
              {c.company && (
                <span className="hidden items-center gap-1 text-xs text-muted sm:flex">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="max-w-32 truncate">{c.company}</span>
                </span>
              )}
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-muted">
            No customers match. Switch to{" "}
            <span className="font-medium">New customer</span> to add them.
          </li>
        )}
      </ul>
    </div>
  );
}
