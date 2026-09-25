import { inputClass, labelClass } from "./formStyles";

// The fields for a new customer. Used in the New ticket form
// and the New customer form.
export default function CustomerFields({
  value,
  onChange,
  businesses,
  emailError,
}) {
  // Returns a change handler for one field, e.g. update("email")
  function update(field) {
    return (e) => onChange({ ...value, [field]: e.target.value });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Full name
          <input
            required
            value={value.name}
            onChange={update("name")}
            placeholder="Jane Doe"
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Phone
          <input
            type="tel"
            value={value.phone}
            onChange={update("phone")}
            placeholder="+1 (473) 555-0100"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        Email
        <input
          required
          type="email"
          value={value.email}
          onChange={update("email")}
          placeholder="jane@company.com"
          autoComplete="off"
          className={`${inputClass} ${emailError ? "border-red-400" : ""}`}
        />
        {emailError && (
          <span className="text-xs font-normal text-red-500">{emailError}</span>
        )}
      </label>

      <label className={labelClass}>
        <span>
          Business <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          list="business-list"
          value={value.company}
          onChange={update("company")}
          placeholder="Leave empty if they're an individual"
          autoComplete="off"
          className={inputClass}
        />
        {/* Suggests businesses you already have while typing */}
        <datalist id="business-list">
          {businesses.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
    </>
  );
}
