// Maintenance, stage 3, last job: reports what the investigation found on
// the GitHub issue, and if a fix passed every check, opens a pull request
// for a person to review. Runs on a clean machine (ai-investigate.yml)
// that never runs any code the AI wrote: the fix is rebuilt here from the
// AI's plan (data), checked against the rules again (policy.mjs), and
// pushed to its own branch. Never to main, and nothing is ever merged:
// that's a person's decision.
//
// The comment it leaves ends with a hidden line the helpdesk reads to
// update the incident (server/src/investigations.js):
//   <!-- helpdesk-maintenance:{"incident":12,"outcome":"pr",...} -->
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyEdits, checkPath, diffPaths, lowRisk, validatePlan } from "./policy.mjs";

const REPO = process.env.GITHUB_REPOSITORY;
const ISSUE = Number(process.env.ISSUE_NUMBER);
const RUN_URL = process.env.RUN_URL;
const DIR = process.env.REPORT_DIR;
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const BASE = event.repository?.default_branch ?? "main";
const incidentId = Number(String(event.issue?.body ?? "").match(/<!-- helpdesk-incident:(\d+) -->/)?.[1] ?? 0);

async function github(method, url, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${method} ${url}: ${data.message ?? res.status}`);
  return data;
}

const load = (file) => {
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

// The last plan that was checked, and its check results
const plans = [load("plan-2/plan.json"), load("plan/plan.json")];
const results = [load("check-2/results.json"), load("check-1/results.json")];
const final = results[0] ? { plan: plans[0], results: results[0] } : { plan: plans[0] ?? plans[1], results: results[1] };
const errors = ["plan", "check", "revise"]
  .flatMap((s) => [load(`plan/error-${s}.json`), load(`plan-2/error-${s}.json`), load(`check-1/error-${s}.json`), load(`check-2/error-${s}.json`)])
  .filter(Boolean)
  .map((e) => `${e.step}: ${e.error}`);

// ---------- The report ----------

const bullets = (items) => (items?.length ? items.map((x) => `- ${x}`).join("\n") : "- (none)");
const ICON = { passed: "✅ passed", failed: "❌ failed" };

function checksTable(r) {
  if (!r) return "_Not run._";
  const rows = r.after.map((c) => {
    const before = r.before.find((b) => b.name === c.name)?.status;
    const note = c.status === "failed" && before === "failed" ? "already failing before the fix" : c.optional ? "informational" : "";
    return `| ${c.name} | ${ICON[c.status] ?? c.status} | ${ICON[before] ?? before ?? "?"} | ${note} |`;
  });
  return ["| Check | After the fix | Before | Note |", "|---|---|---|---|", ...rows].join("\n");
}

function failures(r) {
  if (!r) return "";
  const failed = r.after.filter((c) => c.status === "failed");
  if (!failed.length) return "";
  return failed
    .map((c) => `<details><summary>${c.name}: output</summary>\n\n\`\`\`\n${c.output.replace(/```/g, "'''")}\n\`\`\`\n</details>`)
    .join("\n");
}

function findings(p) {
  if (!p) return "_The investigation didn't produce findings._";
  return `**Summary:** ${p.summary || "(none)"}

**Root cause** (confidence: **${p.confidence}**): ${p.rootCause || "(not determined)"}

**Confirmed:**
${bullets(p.confirmed)}

**Hypotheses (not proven):**
${bullets(p.hypotheses)}`;
}

function status(data) {
  return `<!-- helpdesk-maintenance:${JSON.stringify(data)} -->`;
}

// ---------- Opening the pull request ----------

async function openPullRequest(p, r) {
  // The rules again, on this clean machine
  const v = validatePlan(p);
  if (v.errors.length) throw new Error(`The plan breaks the rules: ${v.errors.join("; ")}`);
  const branch = `ai-fix/incident-${incidentId}-${process.env.GITHUB_RUN_ID}`;
  git("checkout", "-b", branch);
  const files = applyEdits((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null), v.plan.edits);
  for (const [file, text] of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  git("add", "--", ...files.keys());
  const touched = diffPaths(git("diff", "--cached"));
  for (const f of touched) if (!checkPath(f).ok) throw new Error(`Refused: the fix touches ${f}`);
  if (!touched.length) throw new Error("The fix changes nothing.");
  git("-c", "user.name=helpdesk-maintenance[bot]", "-c", "user.email=helpdesk-maintenance@users.noreply.github.com",
    "commit", "-m", `Fix incident #${incidentId}: ${String(p.incident?.title ?? "").slice(0, 60)}`,
    "-m", `Proposed by the AI investigation (${p.provider} ${p.model}). Needs a person's review.`);
  git("push", "origin", branch);

  const sensitive = v.sensitive || p.sensitive;
  const risk = lowRisk({ plan: p, passed: r?.passed, touched, sensitive });
  const tests = touched.filter((f) => f.startsWith("server/test/"));
  const body = `## Bug
Incident #${incidentId} in the helpdesk (issue #${ISSUE}): ${p.incident?.title ?? ""}

${findings(p)}

## Proposed fix
${p.summary}

**Files changed:**
${bullets(touched.map((f) => `\`${f}\``))}

## Tests
**Added or changed:** ${tests.length ? tests.map((f) => `\`${f}\``).join(", ") : "none"}
${bullets(p.tests)}

## Test results
Run on a separate machine, against a throwaway test database. That machine had no secrets and no write access.

${checksTable(r)}

${failures(r)}

## Security and compatibility
${sensitive ? `> [!WARNING]\n> **Sensitive change**: ${[...new Set([...(v.sensitiveReasons ?? []), ...(p.sensitiveReasons ?? [])])].join("; ")}. This must never be approved automatically. Review it line by line.\n` : ""}
${bullets(p.risks)}

## Check by hand before approving
${bullets(p.manualChecks)}

**Low-risk:** ${risk.ok ? "yes (small, highly confident, every check passed, no sensitive files). Still needs a person: automatic approval is off." : `no: ${risk.reasons.join("; ")}.`}

---
Written by an AI (${p.provider}, ${p.model}), attempt ${p.attempt}. [Investigation run](${RUN_URL}). **Review it like any other change.** Merging is the approval, and only a person can do it.
<!-- helpdesk-incident:${incidentId} -->`;

  const pr = await github("POST", "/pulls", {
    title: `Fix incident #${incidentId}: ${String(p.incident?.title ?? "").slice(0, 80)}`,
    head: branch,
    base: BASE,
    body,
    draft: false,
  });
  await github("POST", `/issues/${pr.number}/labels`, {
    labels: ["ai-fix", ...(sensitive ? ["sensitive-change"] : []), ...(risk.ok ? ["low-risk"] : [])],
  });
  return { pr, sensitive };
}

// ---------- What happened ----------

const p = final.plan;
const r = final.results;
let outcome;
let comment;
try {
  if (!p) {
    outcome = "failed";
    comment = `## Investigation didn't finish\n\n${bullets(errors)}\n\n[See the run](${RUN_URL}).`;
  } else if (!p.canFix || !p.edits?.length || p.problems?.length) {
    outcome = "no-fix";
    comment = `## Investigation: no fix proposed\n\n${findings(p)}\n\n${p.problems?.length ? `**Why no fix:**\n${bullets(p.problems)}\n\n` : ""}**Risks noted:**\n${bullets(p.risks)}\n\n[Investigation run](${RUN_URL}).`;
  } else if (!r?.passed) {
    outcome = "failed";
    comment = `## Investigation: the proposed fix failed its checks\n\nIt was tried ${p.attempt} time${p.attempt === 1 ? "" : "s"}. No pull request was opened.\n\n${findings(p)}\n\n${checksTable(r)}\n\n${failures(r)}\n\n[Investigation run](${RUN_URL}).`;
  } else {
    const { pr, sensitive } = await openPullRequest(p, r);
    outcome = "pr";
    comment = `## Fix proposed: #${pr.number}\n\n${findings(p)}\n\nEvery required check passed. ${sensitive ? "**It's a sensitive change: review it line by line.** " : ""}It needs a person's review: merging it is the approval.`;
    p.prNumber = pr.number;
    p.prUrl = pr.html_url;
    p.sensitiveFinal = sensitive;
  }
} catch (err) {
  outcome = "failed";
  comment = `## Opening the pull request failed\n\n${err.message}\n\n[See the run](${RUN_URL}).`;
}

const data = {
  incident: incidentId,
  outcome,
  summary: String(p?.summary ?? "").slice(0, 1500),
  rootCause: String(p?.rootCause ?? "").slice(0, 1500),
  confidence: p?.confidence ?? null,
  confirmed: (p?.confirmed ?? []).slice(0, 10),
  hypotheses: (p?.hypotheses ?? []).slice(0, 10),
  checks: (r?.after ?? []).map((c) => ({ name: c.name, status: c.status, optional: c.optional })),
  attempt: p?.attempt ?? 0,
  sensitive: Boolean(p?.sensitiveFinal ?? p?.sensitive),
  prNumber: p?.prNumber ?? null,
  prUrl: p?.prUrl ?? null,
  runUrl: RUN_URL,
  provider: p?.provider ?? null,
  model: p?.model ?? null,
};
await github("POST", `/issues/${ISSUE}/comments`, { body: `${comment}\n\n${status(data)}` });
if (outcome !== "pr")
  await github("POST", `/issues/${ISSUE}/labels`, { labels: [outcome === "no-fix" ? "ai-no-fix" : "ai-failed"] }).catch(() => {});
console.log(`Outcome: ${outcome}`);
