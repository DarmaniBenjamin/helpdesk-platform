// Shared styles for forms, so every form in the app looks the same.

// text-base on phones (16px) stops iPhones zooming in when you tap a field
export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:shadow-[0_0_18px_-6px_var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

// Buttons: slim (32px on computers, 36px on phones), with crisp corners.
// The main one is blue, with a thin highlight along its top edge and a
// soft blue glow under it.
export const primaryButton =
  "h-9 flex-1 cursor-pointer rounded-md bg-brand px-3.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_4px_14px_-6px_var(--color-brand)] transition hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_6px_20px_-6px_var(--color-brand)] hover:brightness-110 active:scale-[0.98] sm:h-8 sm:flex-none";

export const secondaryButton =
  "h-9 flex-1 cursor-pointer rounded-md border border-line bg-white px-3 text-sm font-medium shadow-[0_1px_2px_rgb(11_22_48/0.05)] transition hover:border-brand/50 hover:text-brand active:scale-[0.98] sm:h-8 sm:flex-none";
