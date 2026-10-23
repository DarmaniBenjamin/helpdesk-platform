// Shared styles for forms, so every form in the app looks the same.

// text-base on phones (16px) stops iPhones zooming in when you tap a field
export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:shadow-[0_0_18px_-6px_var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

// Buttons: glass and slim, with crisp corners (btn-glass and btn-clear, in
// index.css). On one line: 28px tall on computers (13px text), 34px on
// phones (14px). A label that wraps makes the button taller instead of
// spilling out of it. Each starts from its label's width (basis-auto), so
// in a row that wraps, a button that doesn't fit moves to the next line
// instead of squeezing its label.
export const primaryButton =
  "btn-glass inline-flex min-h-8.5 flex-1 basis-auto cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-0.5 text-center text-sm leading-5 font-medium transition active:scale-[0.98] sm:min-h-7 sm:flex-none sm:text-[13px]";

export const secondaryButton =
  "btn-clear inline-flex min-h-8.5 flex-1 basis-auto cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-0.5 text-center text-sm leading-5 font-medium transition active:scale-[0.98] sm:min-h-7 sm:flex-none sm:text-[13px]";
