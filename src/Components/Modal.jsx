import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A reusable pop-up: bottom sheet on phones, centered box on bigger screens.
// Fixed header and footer, and only the middle scrolls.
// Pass onSubmit to turn the middle + footer into a form.
export default function Modal({ title, onClose, onSubmit, footer, children }) {
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
      onClick={close}
      className="fixed inset-0 z-50 flex items-end justify-center overscroll-none bg-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
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
