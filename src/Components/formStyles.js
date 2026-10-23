// Shared styles for forms, so every form in the app looks the same.

// text-base on phones (16px) stops iPhones zooming in when you tap a field
export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:shadow-[0_0_18px_-6px_var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

// Buttons: slim (30px on computers, 36px on phones), with crisp corners.
// The main one is glass: see-through blue with a glowing edge (btn-glass,
// in index.css, with its dark-mode version).
export const primaryButton =
  "btn-glass h-9 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition active:scale-[0.98] sm:h-7.5 sm:flex-none";

export const secondaryButton =
  "h-9 flex-1 cursor-pointer rounded-md border border-line bg-white px-3 text-sm font-medium shadow-[0_1px_2px_rgb(11_22_48/0.05)] transition hover:border-brand/50 hover:text-brand active:scale-[0.98] sm:h-7.5 sm:flex-none";
