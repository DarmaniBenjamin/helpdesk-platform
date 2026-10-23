// Shared styles for forms, so every form in the app looks the same.

// text-base on phones (16px) stops iPhones zooming in when you tap a field
export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:shadow-[0_0_18px_-6px_var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

// Buttons: glass and slim (28px on computers, 34px on phones), with crisp
// corners (btn-glass and btn-clear, in index.css).
export const primaryButton =
  "btn-glass h-8.5 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition active:scale-[0.98] sm:h-7 sm:flex-none";

export const secondaryButton =
  "btn-clear h-8.5 flex-1 cursor-pointer rounded-md px-2.5 text-sm font-medium transition active:scale-[0.98] sm:h-7 sm:flex-none";
