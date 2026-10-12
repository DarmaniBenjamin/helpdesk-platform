// Errors in people's browsers, sent to the server as incidents
// (server/src/incidents.js, POST /api/incidents/browser), so the
// Maintenance page shows what goes wrong on people's screens too.
//
// Kept quiet and cheap:
//   - each different error is sent once per page load, 10 at most
//   - errors that aren't the app's: browser extensions, "Script error."
//     from other sites, the harmless ResizeObserver warning, and old tabs
//     that can't load a page after an update, are left out
//   - errors from the server (ApiError) aren't sent: the server already
//     records its own errors
//   - nothing is sent for people who aren't signed in (the server refuses
//     it), and sending can never cause another error
import { ApiError } from "./api";

const MAX_PER_PAGE_LOAD = 10;
const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  // An old tab after an update: the page's files have new names
  /dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|error loading dynamically imported/i,
  /^cancell?ed$/i,
];
const EXTENSION = /(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//;

const sent = new Set();

export function reportError(error, kind = "runtime") {
  try {
    if (sent.size >= MAX_PER_PAGE_LOAD) return;
    // From the server: it records its own errors (ApiError has a status)
    if (error instanceof ApiError || typeof error?.status === "number") return;
    const message = String(error?.message ?? error ?? "").slice(0, 1000);
    if (!message || IGNORE.some((pattern) => pattern.test(message))) return;
    const stack = String(error?.stack ?? "");
    if (EXTENSION.test(stack)) return;
    const key = `${message}|${window.location.pathname}`;
    if (sent.has(key)) return;
    sent.add(key);
    fetch("/api/incidents/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        name: String(error?.name ?? "Error").slice(0, 60),
        message,
        stack: stack.slice(0, 8000),
        page: window.location.pathname,
        kind,
      }),
    }).catch(() => {});
  } catch {
    // Reporting an error must never cause one
  }
}

let installed = false;
export function installErrorReporter() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportError(event.error ?? new Error(event.message), "runtime");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, "promise");
  });
}
