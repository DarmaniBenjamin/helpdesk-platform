// Talking to the backend. Every request goes to /api/..., which the Vite
// dev server passes on to the server folder (see vite.config.js).
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

// e.g. await api("/auth/login", { method: "POST", body: { email, password } })
// `raw`: send a file as it is (e.g. a backup), instead of `body`
export async function api(path, { method = "GET", body, raw } = {}) {
  const headers = {};
  if (body || raw) headers["Content-Type"] = "application/json";
  if (tabId) headers["X-Tab-Id"] = tabId;
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

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // No message from our server usually means it isn't running
    const message =
      data?.error ??
      (res.status >= 500
        ? "Can't reach the server. Is the backend running?"
        : "Something went wrong.");
    throw new ApiError(message, res.status);
  }
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
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      data?.error ??
        (res.status === 413
          ? "Those files are too big."
          : "The files couldn't be uploaded."),
      res.status,
    );
  }
  return data;
}
