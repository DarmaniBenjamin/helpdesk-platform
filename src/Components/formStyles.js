// Shared styles for forms, so every form in the app looks the same.

// text-base on phones (16px) stops iPhones zooming in when you tap a field
export const inputClass =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

export const primaryButton =
  "h-11 flex-1 cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:flex-none";

export const secondaryButton =
  "h-11 flex-1 cursor-pointer rounded-lg border border-line px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97] sm:flex-none";
