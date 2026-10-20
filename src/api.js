// Talking to the backend. Every request goes to /api/... on the same
// address as the website: locally, the Vite dev server passes them on to
// the server folder (see vite.config.js); on the live site (Render), the
// same server serves both the website and /api.
// The sign-in cookie is sent along automatically.

// An error with the server's own message, e.g. "Please sign in."
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// This tab's ID on the live connection (see DataProvider.jsx). It's sent
// with every change, so when the server tells all tabs "this changed",
// the tab that made the change knows it already has it.
let tabId = null;
export function setTabId(id) {
  tabId = id;
}

// What to say when the answer isn't from our server at all (e.g. a web
// page came back instead of data)
const NOT_OUR_SERVER =
  "The helpdesk server didn't answer. If this is the live site, make sure you're on the Web Service's address (open /api/health there to check).";

// Important actions need a code from the person's email first
// (server/src/confirm.js). ConfirmGate.jsx registers how to ask for it:
// a function that gets { action, method, error } and resolves with
// { code } or { password }, or null if they cancel.
let askForConfirmation = null;
export function setConfirmationAsker(fn) {
  askForConfirmation = fn;
}

// e.g. await api("/auth/login", { method: "POST", body: { email, password } })
// `raw`: send a file as it is (e.g. a backup), instead of `body`
export async function api(path, { method = "GET", body, raw } = {}, confirmed) {
  const headers = {};
  if (body || raw) headers["Content-Type"] = "application/json";
  if (tabId) headers["X-Tab-Id"] = tabId;
  if (confirmed?.code) headers["X-Confirm-Code"] = confirmed.code;
  // (encoded: headers can't carry letters like é as they are)
  if (confirmed?.password)
    headers["X-Confirm-Password"] = encodeURIComponent(confirmed.password);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: raw ?? (body ? JSON.stringify(body) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  // Our server always answers in JSON. Anything else (a web page, an
  // empty answer) means something in between answered instead.
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const data = isJson ? await res.json().catch(() => null) : null;
  // An important action: ask for the code, then send it again with it
  if (res.status === 428 && data?.confirm && askForConfirmation) {
    const answer = await askForConfirmation(data);
    if (!answer) throw new ApiError("Cancelled: nothing was changed.", 428);
    return api(path, { method, body, raw }, answer);
  }
  if (!res.ok) {
    // No message from our server usually means it isn't running
    const message =
      data?.error ??
      (res.status >= 500
        ? "Can't reach the server. Is the backend running?"
        : isJson
          ? "Something went wrong."
          : NOT_OUR_SERVER);
    throw new ApiError(message, res.status);
  }
  if (data === null) throw new ApiError(NOT_OUR_SERVER, res.status);
  return data;
}

// Uploads files (e.g. from a file picker) to be attached to a message.
// Returns the saved files: [{ id, name, size, image }]. Their IDs are
// then sent with the reply, note or request (see useAttachments.js).
export async function uploadFiles(files) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  let res;
  try {
    // No Content-Type header: the browser sets it, with the file boundary
    res = await fetch("/api/attachments", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(
      data?.error ??
        (res.status === 413
          ? "Those files are too big."
          : isJson
            ? "The files couldn't be uploaded."
            : NOT_OUR_SERVER),
      res.status,
    );
  }
  if (data === null) throw new ApiError(NOT_OUR_SERVER, res.status);
  return data;
}
