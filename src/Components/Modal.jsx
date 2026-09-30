import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A reusable pop-up: a centered box with space around it on every screen size,
// so you can still see the page behind it.
// Fixed header and footer, and only the middle scrolls.
// Pass onSubmit to turn the middle + footer into a form.
// It comes in with a short animation: the background fades, the box rises
// (index.css). It goes out the same way, however it's closed: the X,
// Cancel, clicking outside, Escape, or after saving (see below).
export default function Modal({ title, onClose, onSubmit, footer, children }) {
  const overlayRef = useRef(null);

  // The closing animation. The page removes the pop-up the moment it's
  // closed, so just before it goes, an exact copy is put in its place to
  // play the animation, then removed. The copy can't be clicked, so the
  // page behind works straight away.
  useLayoutEffect(() => {
    const openedAt = Date.now();
    const overlay = overlayRef.current;
    return () => {
      // (React's development mode opens and closes everything once as a
      // check when it first appears; no animation for that)
      if (!overlay || Date.now() - openedAt < 50) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const copy = overlay.cloneNode(true);
      // Typed text isn't copied by itself, so it's copied across, so the
      // fields don't look empty while it fades
      const from = overlay.querySelectorAll("input, textarea, select");
      copy.querySelectorAll("input, textarea, select").forEach((field, i) => {
        field.value = from[i]?.value ?? field.value;
      });
      copy.setAttribute("aria-hidden", "true");
      copy.classList.replace("animate-fade-in", "animate-fade-out");
      copy
        .querySelector("[role='dialog']")
        ?.classList.replace("animate-dialog-in", "animate-dialog-out");
      document.body.appendChild(copy);
      setTimeout(() => copy.remove(), 180);
    };
  }, []);

  function close() {
    // Close the phone keyboard first. Removing a focused input while the
    // keyboard is up can leave iPhones stuck at a strange scroll position.
    document.activeElement?.blur();
    onClose();
  }

  // While open: stop the page behind from scrolling, and let Escape close it
  useEffect(() => {
    const html = document.documentElement;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    function handleKey(e) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", handleKey);

    // Runs when the modal goes away: give scrolling back to the page
    return () => {
      html.style.overflow = "";
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = (
    <>
      {/* overflow-x-hidden + touch-pan-y: only up/down scrolling, never sideways */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 touch-pan-y sm:px-6">
        {children}
      </div>
      {footer && (
        <div className="flex shrink-0 gap-2 border-t border-line px-5 py-3 sm:justify-end sm:px-6">
          {footer}
        </div>
      )}
    </>
  );

  return createPortal(
    <div
      ref={overlayRef}
      onClick={close}
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center overscroll-none bg-ink/40 p-4 backdrop-blur-sm sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-dialog-in flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3 sm:px-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
