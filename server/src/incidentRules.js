// The rules behind incidents (incidents.js), kept apart so they can be
// tested without a database (server/test/incidentRules.test.js):
//   - redact():      takes secrets and personal details out of any text
//                    before it's stored or sent anywhere
//   - fingerprint(): the same underlying error always gets the same
//                    fingerprint, so repeats are counted on one incident
//                    instead of making new ones
//   - categorize():  database, network, runtime...
//   - triage():      how serious it is, and whether it's worth an AI
//                    investigation (most errors aren't)
import crypto from "node:crypto";

// ---------- Redaction ----------

const RULES = [
  // Connection strings: postgres://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, "$1[redacted]@"],
  // Authorization: Bearer xxx / Basic xxx
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [redacted]"],
  // password=..., "token": "...", api_key: ..., cookie=...
  [
    /\b(pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|auth(?:orization)?|cookie|session|signature)(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi,
    "$1$2[redacted]",
  ],
  // Well-known key formats
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted-key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, "[redacted-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]"],
  // Long random-looking strings: tokens, hashes, keys (32+ characters)
  [/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-key]"],
  [/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted-key]"],
  // Personal details: email addresses and phone numbers
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/(?<![\w.])\+?\d[\d ().-]{6,}\d(?![\w.])/g, "[number]"],
];

// Text with secrets and personal details taken out, cut to max characters
export function redact(text, max = 2000) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  // Control characters (except new lines and tabs) can't hurt anything
  // stored, but they can mess up logs and the page
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

// ---------- Stack traces ----------

// "    at handler (/opt/helpdesk-platform/server/src/tickets.js:612:9)"
// -> "handler (server/src/tickets.js:612)". Only the app's own files:
// node_modules and Node's insides say nothing about which bug it is.
export function appFrames(stack, limit = 8) {
  const frames = [];
  for (const line of String(stack ?? "").split("\n")) {
    const m = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?\s*$/);
    if (!m) continue;
    const [, fn, file, lineNo] = m;
    if (/node_modules|node:internal|^node:|<anonymous>/.test(file)) continue;
    const rel = file
      .replace(/^file:\/\//, "")
      .replace(/^.*?\/((?:server\/)?src\/)/, "$1")
      .replace(/^https?:\/\/[^/]+\//, "")
      .replace(/\?.*$/, "");
    frames.push(`${fn || "(anonymous)"} (${rel}:${lineNo})`);
    if (frames.length >= limit) break;
  }
  return frames;
}

// A stack trace that's safe to keep: redacted, app frames first, short
export function cleanStack(stack) {
  const frames = appFrames(stack, 15);
  const head = String(stack ?? "").split("\n")[0] ?? "";
  return redact([head, ...frames.map((f) => `    at ${f}`)].join("\n"), 4000);
}

// ---------- Grouping ----------

// The message with what changes between occurrences taken out: numbers,
// IDs, quoted values, so "ticket 12 not found" and "ticket 40 not found"
// count as the same error
export function normalizeMessage(message) {
  return redact(message, 500)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/(["'`]).*?\1/g, "<value>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// The same underlying error always gets the same fingerprint: where it
// happened (the app's top 3 frames, without line numbers, which change
// with every edit), what kind it is, and the normalized message
export function fingerprint({ component, category, message, stack }) {
  const where = appFrames(stack, 3)
    .map((f) => f.replace(/:\d+\)$/, ")"))
    .join("|");
  return crypto
    .createHash("sha256")
    .update([component, category, normalizeMessage(message), where].join("\n"))
    .digest("hex")
    .slice(0, 32);
}

// ---------- What kind of error ----------

const NETWORK = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function categorize(err) {
  const code = String(err?.code ?? "");
  // PostgreSQL's own error codes are 5 characters (e.g. 23505, 42P01)
  if (/^[0-9A-Z]{5}$/.test(code) && (err?.severity || err?.routine))
    return "database";
  if (/database|postgres|relation .* does not exist|connection terminated/i.test(err?.message ?? ""))
    return "database";
  if (NETWORK.has(code) || err?.name === "AbortError" || err?.name === "TimeoutError")
    return "network";
  if (err?.name === "SyntaxError" && /JSON/i.test(err?.message ?? "")) return "bad-input";
  if (err?.name === "TypeError" || err?.name === "ReferenceError" || err?.name === "RangeError")
    return "code";
  return "runtime";
}

// ---------- How serious, and worth investigating? ----------

// severity: critical, high, medium, low
// investigate: whether it should be sent for an AI investigation. Most
// errors aren't: network blips, bad input from someone, one-offs.
export function triage({ source, category, component, count = 1 }) {
  let severity = "medium";
  if (source === "crash" || component === "health") severity = "critical";
  else if (category === "database" || source === "spike") severity = "high";
  else if (category === "network" || category === "bad-input") severity = "low";
  else if (source === "browser") severity = count >= 5 ? "medium" : "low";
  else if (count >= 10) severity = "high";

  let investigate = false;
  if (source === "user") investigate = true; // a person reported it
  else if (category === "network" || category === "bad-input") investigate = false;
  else if (source === "crash") investigate = true;
  // Browser errors are noisier (extensions, old tabs): they need more repeats
  else if (source === "browser") investigate = count >= 5;
  else if (category === "code") investigate = count >= 2;
  else investigate = count >= 3;
  return { severity, investigate };
}

// A short title for the incident list
export function titleFor({ component, category, message }) {
  const first = redact(message, 120).split("\n")[0];
  return `${component}: ${first || category}`;
}
