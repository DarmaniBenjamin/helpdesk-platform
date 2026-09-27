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

// e.g. await api("/auth/login", { method: "POST", body: { email, password } })
export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
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
