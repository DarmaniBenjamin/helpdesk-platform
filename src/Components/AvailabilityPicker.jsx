import { Check } from "lucide-react";
import { AVAILABILITY } from "./teamRoles";

// Pick Available / Busy / Away. Used on the My profile page and in the
// account menu at the bottom of the sidebar.
export default function AvailabilityPicker({ value, onChange }) {
  return (
    <div role="radiogroup" className="flex flex-col gap-1">
      {Object.entries(AVAILABILITY).map(([id, option]) => {
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition active:scale-[0.98] ${
              selected ? "bg-brand/10" : "hover:bg-brand/5"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${option.dot}`}
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm ${selected ? "font-medium text-brand" : ""}`}
              >
                {option.label}
              </span>
              <span className="block truncate text-xs text-muted">
                {option.hint}
              </span>
            </span>
            {selected && <Check className="h-4 w-4 shrink-0 text-brand" />}
          </button>
        );
      })}
    </div>
  );
}
