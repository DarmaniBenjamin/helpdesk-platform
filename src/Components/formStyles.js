// Shared styles for forms, so every form in the app looks the same.

// text-base on phones (16px) stops iPhones zooming in when you tap a field
export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:shadow-[0_0_18px_-6px_var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

// Buttons: slimmer on computers (36px), still easy to tap on phones
// (40px). The main one is blue with a soft blue glow under it.
export const primaryButton =
  "h-10 flex-1 cursor-pointer rounded-lg bg-brand px-4 text-sm font-medium text-white shadow-[0_6px_20px_-8px_var(--color-brand)] transition hover:shadow-[0_8px_26px_-6px_var(--color-brand)] hover:brightness-110 active:scale-[0.98] sm:h-9 sm:flex-none";

export const secondaryButton =
  "h-10 flex-1 cursor-pointer rounded-lg border border-line bg-white px-3.5 text-sm transition hover:border-brand/50 hover:text-brand active:scale-[0.98] sm:h-9 sm:flex-none";
