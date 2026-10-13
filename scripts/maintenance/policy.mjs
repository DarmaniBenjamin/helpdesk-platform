// The rules every AI-proposed change has to pass, whatever the AI says.
// Used when the AI's answer arrives (investigate.mjs) and again, on a
// clean machine, just before a pull request is opened (propose.mjs).
// Tested in server/test/maintenancePolicy.test.js.
//
// The AI only ever proposes edits as data: { path, find, replace } to
// change one exact piece of an existing file, or { path, create } for a
// new file. It can't run anything, and these rules decide which files it
// may touch at all.

// Never: the machinery that runs, deploys and protects the app
const DENIED = [
  [/^\.github\//, "GitHub workflows"],
  [/^deploy\//, "deploy and install scripts"],
  [/^scripts\/maintenance\//, "the maintenance system itself"],
  [/(^|\/)\.env/, "settings files with secrets"],
  [/(^|\/)package(-lock)?\.json$/, "packages (no new dependencies)"],
  [/^server\/drizzle\//, "database migrations"],
  [/^server\/src\/secrets\.js$/, "secret storage"],
  [/(^|\/)(node_modules|dist)\//, "installed or built files"],
];

// Only: the app's own source code and its tests
const ALLOWED = [
  /^src\/.+\.(js|jsx|css)$/,
  /^server\/src\/.+\.js$/,
  /^server\/test\/.+\.test\.js$/,
];

// Allowed, but a person must look extra carefully: never auto-approved
const SENSITIVE_FILES = [
  /^server\/src\/(auth|permissions|backup|offsite|restore|setup-owner|password|invites|team|incidents|incidentRules)\.js$/,
  /^server\/src\/db\//,
  /^src\/Components\/teamRoles\.js$/,
];
const SENSITIVE_TEXT =
  /\b(requireRole|requireAuth|ADMINS|STAFF|SUPER_ADMIN|role\s*===|password|session|token|secret|seal\(|unseal\(|DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|\.delete\()/i;

const MAX_EDITS = 15;
const MAX_CHANGED_CHARS = 200_000;

// Is the AI allowed to change this file? { ok, reason, sensitive }
export function checkPath(path) {
  const p = String(path ?? "");
  if (!p || p.startsWith("/") || p.includes("\\") || p.split("/").includes(".."))
    return { ok: false, reason: `"${p}" isn't a plain path inside the project` };
  for (const [pattern, what] of DENIED)
    if (pattern.test(p)) return { ok: false, reason: `${p}: ${what} can't be changed by the AI` };
  if (!ALLOWED.some((pattern) => pattern.test(p)))
    return { ok: false, reason: `${p}: only the app's source (src/, server/src/) and tests (server/test/) can be changed` };
  return { ok: true, sensitive: SENSITIVE_FILES.some((pattern) => pattern.test(p)) };
}

// The AI's answer as JSON, even if it wrapped it in ```json fences or
// added words around it. null if there's no JSON in it.
export function parseModelJson(text) {
  const t = String(text ?? "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const list = (value) =>
  Array.isArray(value) ? value.filter((x) => typeof x === "string").map((x) => x.slice(0, 2000)).slice(0, 20) : [];

// Checks the shape of the AI's answer and every edit in it.
// Returns { plan, errors, sensitive, sensitiveReasons }.
export function validatePlan(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object")
    return { plan: null, errors: ["The AI's answer couldn't be read: it wasn't in the format asked for (JSON). The run's log shows how it started."] };
  const confidence = ["low", "medium", "high"].includes(raw.confidence) ? raw.confidence : "low";
  const plan = {
    summary: String(raw.summary ?? "").slice(0, 4000),
    rootCause: String(raw.rootCause ?? "").slice(0, 4000),
    confirmed: list(raw.confirmed),
    hypotheses: list(raw.hypotheses),
    confidence,
    canFix: raw.canFix === true,
    risks: list(raw.risks),
    manualChecks: list(raw.manualChecks),
    tests: list(raw.tests),
    edits: [],
  };
  const edits = Array.isArray(raw.edits) ? raw.edits : [];
  if (edits.length > MAX_EDITS) errors.push(`Too many edits (${edits.length}, at most ${MAX_EDITS}).`);
  let size = 0;
  let sensitive = false;
  const sensitiveReasons = [];
  for (const edit of edits.slice(0, MAX_EDITS)) {
    const path = String(edit?.path ?? "");
    const verdict = checkPath(path);
    if (!verdict.ok) {
      errors.push(verdict.reason);
      continue;
    }
    if (typeof edit.create === "string") {
      size += edit.create.length;
      plan.edits.push({ path, create: edit.create });
    } else if (typeof edit.find === "string" && typeof edit.replace === "string" && edit.find) {
      size += edit.find.length + edit.replace.length;
      plan.edits.push({ path, find: edit.find, replace: edit.replace });
    } else {
      errors.push(`${path}: an edit needs "find" and "replace", or "create".`);
      continue;
    }
    if (verdict.sensitive) {
      sensitive = true;
      sensitiveReasons.push(`${path} is security-sensitive`);
    }
    const added = edit.create ?? edit.replace;
    if (SENSITIVE_TEXT.test(added)) {
      sensitive = true;
      sensitiveReasons.push(`${path}: the change touches sign-in, permissions, secrets or deleting data`);
    }
  }
  if (size > MAX_CHANGED_CHARS) errors.push("The changes are too big for an automatic fix.");
  if (plan.canFix && !plan.edits.length && !errors.length)
    errors.push("The AI said it can fix it, but proposed no changes.");
  return { plan, errors, sensitive, sensitiveReasons: [...new Set(sensitiveReasons)] };
}

// Applies edits to file contents. read(path) returns the file's text, or
// null if it doesn't exist. Returns Map(path -> new text). Throws with a
// clear reason if an edit doesn't fit (the AI is told and can try again).
export function applyEdits(read, edits) {
  const files = new Map();
  const current = (path) => (files.has(path) ? files.get(path) : read(path));
  for (const edit of edits) {
    const verdict = checkPath(edit.path);
    if (!verdict.ok) throw new Error(verdict.reason);
    const text = current(edit.path);
    if (edit.create !== undefined) {
      if (text !== null && text !== undefined)
        throw new Error(`${edit.path} already exists: change it with find/replace instead of create`);
      files.set(edit.path, edit.create);
      continue;
    }
    if (text === null || text === undefined) throw new Error(`${edit.path} doesn't exist`);
    const count = text.split(edit.find).length - 1;
    if (count === 0) throw new Error(`${edit.path}: the text to find isn't in the file (it must match exactly, spaces included)`);
    if (count > 1) throw new Error(`${edit.path}: the text to find is in the file ${count} times; include more lines so it's unique`);
    files.set(edit.path, text.replace(edit.find, () => edit.replace));
  }
  return files;
}

// The project's files mentioned in a stack trace
export function stackFiles(stack) {
  const found = String(stack ?? "").match(/\b(?:server\/src|server\/test|src)\/[\w./-]+\.jsx?\b/g) ?? [];
  return [...new Set(found)];
}

// The files a pull request's diff touches (checked again before opening it)
export function diffPaths(patch) {
  const paths = new Set();
  for (const m of String(patch).matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    paths.add(m[1]);
    paths.add(m[2]);
  }
  return [...paths];
}

// Low-risk: the narrow kind of fix a future administrator might allow to
// be approved without a person (docs/maintenance.md). Today it's only a
// label on the pull request: nothing is ever merged automatically.
// Everything here must hold: one first attempt, high confidence, every
// check passed, not sensitive, at most 3 files and 60 changed lines, and
// only the app's own source and tests.
export function lowRisk({ plan, passed, touched, sensitive }) {
  const reasons = [];
  if (sensitive) reasons.push("it's a sensitive change");
  if (!passed) reasons.push("not every check passed");
  if (plan?.confidence !== "high") reasons.push("the AI isn't highly confident");
  if (plan?.attempt !== 1) reasons.push("it took more than one attempt");
  if (!touched?.length || touched.length > 3) reasons.push("it changes more than 3 files");
  for (const f of touched ?? []) {
    const verdict = checkPath(f);
    if (!verdict.ok || verdict.sensitive) reasons.push(`${f} isn't a low-risk file`);
  }
  const lines = (plan?.edits ?? []).reduce(
    (n, e) => n + String(e.create ?? e.replace ?? "").split("\n").length,
    0,
  );
  if (lines > 60) reasons.push(`it changes ${lines} lines (more than 60)`);
  return { ok: reasons.length === 0, reasons };
}
