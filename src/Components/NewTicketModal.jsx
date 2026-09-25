import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, CircleCheck } from "lucide-react";

const departments = [
  "IT Support",
  "Networking",
  "Microsoft 365",
  "Server & Backups",
  "CCTV & Security",
  "Billing",
];
const priorities = ["Low", "Medium", "High", "Urgent"];

// Shared input style. text-base on phones stops iPhones zooming in.
const inputClass =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-base placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-sm";

export default function NewTicketModal({ open, onClose }) {
  const [priority, setPriority] = useState("Medium");
  const [submitted, setSubmitted] = useState(false);

  // While open: stop the page behind from scrolling, and let Escape close it
  useEffect(() => {
    if (!open) return;

    const html = document.documentElement;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    function handleKey(e) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);

    // Cleanup runs when the modal closes: give scrolling back to the page
    return () => {
      html.style.overflow = "";
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    // Close the phone keyboard first. Removing a focused input while the
    // keyboard is up can leave iPhones stuck at a strange scroll position.
    document.activeElement?.blur();
    setSubmitted(false);
    setPriority("Medium");
    onClose();
  }

  function handleDone() {
    handleClose();
    // Back to the top of the page, like a fresh load
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(e) {
    e.preventDefault();
    document.activeElement?.blur();
    // Later: send the form to the backend here
    setSubmitted(true);
  }

  if (!open) return null;

  // createPortal draws the modal directly inside <body>, outside the sticky
  // top bar, so nothing on the page can clip it or trap the scrolling.
  return createPortal(
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
    >
      {/* stopPropagation: clicks inside the box shouldn't close it */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl sm:p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {submitted ? "Ticket created" : "New ticket"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            className="cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CircleCheck className="h-12 w-12 text-brand" />
            <p className="text-sm text-muted">
              The ticket was submitted. It will show up in the ticket list once
              the backend is connected.
            </p>
            <button
              type="button"
              onClick={handleDone}
              className="mt-2 h-11 cursor-pointer rounded-lg bg-brand px-6 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Customer name
                <input required placeholder="Jane Doe" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Customer email
                <input
                  required
                  type="email"
                  placeholder="jane@company.com"
                  className={inputClass}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Subject
              <input
                required
                placeholder="Short summary of the issue"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Department
              <select className={`${inputClass} cursor-pointer`}>
                {departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1.5 text-sm font-medium">
              Priority
              <div className="grid grid-cols-4 gap-2">
                {priorities.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`h-10 cursor-pointer rounded-lg border text-sm transition active:scale-[0.97] ${
                      priority === p
                        ? "border-brand bg-brand/10 font-medium text-brand"
                        : "border-line text-muted hover:border-brand/40 hover:text-brand"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Description
              <textarea
                required
                rows={4}
                placeholder="What's happening?"
                className={`${inputClass} h-auto py-2.5`}
              />
            </label>

            <div className="mt-1 flex gap-2 sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="h-11 flex-1 cursor-pointer rounded-lg border border-line px-4 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97] sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-11 flex-1 cursor-pointer rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:flex-none"
              >
                Create ticket
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
