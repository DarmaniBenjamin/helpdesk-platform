import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { CircleCheck, Send, TriangleAlert } from "lucide-react";
import { inputClass, labelClass } from "../formStyles";
import { api } from "../../api";

// The public "Contact support" form: anyone can send a request without
// signing in. It opens at /request, and can be put on another website
// (e.g. your WordPress site) with an iframe: /request?embed=1 shows just
// the form, with no background, so it blends into the page around it.
// See server/src/requests.js for what happens to what's sent.
//
// In an iframe, it tells the page around it how tall it is whenever that
// changes, so the iframe can grow and shrink to fit (no scroll bars).
//
// Extras for the address:
//   theme=dark       dark colours (in an iframe it's light otherwise)
//   accent=1e5aa8    the button and highlight colour, to match your
//                    website (a colour code without the #)
export default function RequestForm() {
  const [params] = useSearchParams();
  const embedded = params.get("embed") === "1";
  const boxRef = useRef(null);

  const [fields, setFields] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    subject: "",
    description: "",
    website: "", // hidden: only spam robots fill it in
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null); // { name, ticketId }

  const set = (key) => (e) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setError("");
  };

  useEffect(() => {
    document.title = "Contact support";
  }, []);

  // In an iframe: light colours unless ?theme=dark, whatever this
  // browser's own setting is, so it matches the website around it
  useEffect(() => {
    if (!embedded) return;
    const dark = params.get("theme") === "dark";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, [embedded, params]);

  // ?accent=1e5aa8: use that colour instead of the helpdesk green
  useEffect(() => {
    const accent = params.get("accent") ?? "";
    if (!/^[0-9a-f]{6}$/i.test(accent)) return;
    const root = document.documentElement.style;
    root.setProperty("--color-brand", `#${accent}`);
    return () => root.removeProperty("--color-brand");
  }, [params]);

  // In an iframe: tell the page around it our height when it changes
  useEffect(() => {
    if (!embedded || window.parent === window || !boxRef.current) return;
    const report = () =>
      window.parent.postMessage(
        {
          type: "deskflow-height",
          height: Math.ceil(boxRef.current.getBoundingClientRect().height),
        },
        "*",
      );
    const watcher = new ResizeObserver(report);
    watcher.observe(boxRef.current);
    report();
    return () => watcher.disconnect();
  }, [embedded, sent]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/requests", { method: "POST", body: fields });
      setSent({
        name: fields.name.trim().split(" ")[0],
        ticketId: result.ticketId,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    setFields((f) => ({ ...f, subject: "", description: "" }));
    setSent(null);
  }

  const form = sent ? (
    <div className="animate-rise-in flex flex-col items-center gap-3 py-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
        <CircleCheck className="h-7 w-7" />
      </span>
      <h2 className="text-xl font-semibold">Thanks, {sent.name}!</h2>
      <p className="max-w-sm text-sm text-muted">
        We've received your request
        {sent.ticketId ? (
          <>
            {" "}
            <strong className="text-ink">#{sent.ticketId}</strong>
          </>
        ) : null}{" "}
        and someone from our team will reach out to you shortly.
      </p>
      <button
        type="button"
        onClick={startAgain}
        className="mt-2 cursor-pointer text-sm font-medium text-brand hover:underline"
      >
        Send another request
      </button>
    </div>
  ) : (
    <form
      onSubmit={handleSubmit}
      className="animate-fade-in flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Your name
          <input
            required
            autoComplete="name"
            value={fields.name}
            onChange={set("name")}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Email
          <input
            required
            type="email"
            autoComplete="email"
            inputMode="email"
            value={fields.email}
            onChange={set("email")}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Phone <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            type="tel"
            autoComplete="tel"
            value={fields.phone}
            onChange={set("phone")}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Company <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            autoComplete="organization"
            value={fields.company}
            onChange={set("company")}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        What do you need help with?
        <input
          required
          value={fields.subject}
          onChange={set("subject")}
          placeholder="e.g. Printer won't print"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Tell us more
        <textarea
          required
          rows={6}
          value={fields.description}
          onChange={set("description")}
          placeholder="What happened, when it started, and anything you've already tried."
          className={`${inputClass} h-auto resize-y py-2.5`}
        />
      </label>

      {/* Hidden from people; spam robots fill it in (see requests.js) */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label>
          Leave this empty
          <input
            tabIndex={-1}
            autoComplete="off"
            value={fields.website}
            onChange={set("website")}
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="grid sm:flex sm:justify-end">
        <button
          type="submit"
          disabled={busy}
          className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-6 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
        >
          <Send className="h-4 w-4" />
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );

  // In an iframe: just the form, no background or heading of our own
  if (embedded) {
    return (
      <div ref={boxRef} className="relative p-1">
        {form}
      </div>
    );
  }

  // On its own: a card in the middle of the page
  return (
    <div className="min-h-dvh bg-page px-4 py-10 sm:py-16">
      <div
        ref={boxRef}
        className="animate-rise-in relative mx-auto max-w-2xl rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-8"
      >
        {!sent && (
          <div className="mb-6">
            <h1 className="text-2xl font-semibold sm:text-3xl">
              Contact support
            </h1>
            <p className="mt-1 text-sm text-muted">
              Tell us what's going on and we'll get back to you.
            </p>
          </div>
        )}
        {form}
      </div>
    </div>
  );
}
