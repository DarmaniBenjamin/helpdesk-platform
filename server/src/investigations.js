// Maintenance, stage 3: sending incidents for an AI investigation, and
// reading what it found. The investigation itself never runs here: this
// file only opens a GitHub issue with the incident's (already redacted)
// details and labels it "ai-investigate". GitHub Actions does the rest
// (.github/workflows/ai-investigate.yml) and reports back on the issue.
//
// The token this server holds can only read and write issues: it can't
// change code, open pull requests, or read secrets. Setup:
// docs/maintenance.md. Without the settings below, all of this is off
// and the helpdesk works exactly the same.
//
// server/.env:
//   MAINT_GITHUB_REPO=owner/repo        the (private) repository
//   MAINT_GITHUB_TOKEN=github_pat_...   fine-grained token: Issues read/write only
//   MAINT_AUTO_INVESTIGATE=on           send incidents worth it by themselves (off: only the button)
//   MAINT_MAX_PER_DAY=3                 investigations started by themselves per day
//   MAINT_MAX_PER_MONTH=20              all investigations per month, the button included
//   MAINT_ALLOW_PUBLIC_REPO=no          incidents are never sent to a public repository
//
//   GET  /api/incidents/ai-status           settings and this month's use (Admins)
//   POST /api/incidents/:id/investigate     investigate now / again (Admins)
import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { incidentEvents, incidents } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS } from "./permissions.js";
import { BadInput } from "./validate.js";
import { addIncidentEvent } from "./incidents.js";

export const investigationsRouter = Router();

const MINUTE = 60 * 1000;
const LABEL = "ai-investigate";
const LABELS = [
  [LABEL, "5319e7", "The helpdesk asked for an AI investigation"],
  ["ai-fix", "0e8a16", "A fix proposed by the AI investigation"],
  ["sensitive-change", "b60205", "Touches sign-in, permissions, secrets or deleting data: never auto-approve"],
  ["ai-no-fix", "fbca04", "The AI investigation didn't propose a fix"],
  ["ai-failed", "d93f0b", "The AI investigation or its fix failed"],
];
// Only the workflow's own comments are believed
const BOT = "github-actions[bot]";

const number = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
export function maintenanceConfig() {
  const repo = String(process.env.MAINT_GITHUB_REPO ?? "").trim();
  return {
    repo,
    token: process.env.MAINT_GITHUB_TOKEN ?? "",
    configured: /^[\w.-]+\/[\w.-]+$/.test(repo) && Boolean(process.env.MAINT_GITHUB_TOKEN),
    auto: !/^(off|no|false|0)$/i.test(process.env.MAINT_AUTO_INVESTIGATE ?? "on"),
    maxPerDay: number("MAINT_MAX_PER_DAY", 3),
    maxPerMonth: number("MAINT_MAX_PER_MONTH", 20),
    allowPublic: /^(yes|true|1)$/i.test(process.env.MAINT_ALLOW_PUBLIC_REPO ?? ""),
  };
}

// ---------- GitHub ----------

async function github(method, url, body) {
  const { repo, token } = maintenanceConfig();
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BadInput("Couldn't reach GitHub. Try again in a minute.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new BadInput(`GitHub said: ${data.message ?? res.status}`);
    err.githubStatus = res.status;
    throw err;
  }
  return data;
}

// Incidents are only ever sent to a private repository
let privateChecked = 0;
async function checkPrivate() {
  const config = maintenanceConfig();
  if (config.allowPublic || Date.now() - privateChecked < 60 * MINUTE) return;
  const repo = await github("GET", "");
  if (!repo.private)
    throw new BadInput(
      `${config.repo} is public: incidents won't be sent to it. Make it private first (docs/maintenance.md).`,
    );
  privateChecked = Date.now();
}

let labelsMade = false;
async function makeLabels() {
  if (labelsMade) return;
  for (const [name, color, description] of LABELS) {
    try {
      await github("POST", "/labels", { name, color, description });
    } catch (err) {
      if (err.githubStatus !== 422) throw err; // 422: it's there already
    }
  }
  labelsMade = true;
}

// ---------- How many have been used ----------

async function usedSince(since) {
  const [row] = await db
    .select({ n: sql`count(*)::int` })
    .from(incidentEvents)
    .where(
      and(
        eq(incidentEvents.type, "investigation_requested"),
        gte(incidentEvents.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}
const startOfDay = () => new Date(new Date().setHours(0, 0, 0, 0));
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

async function usage() {
  return { today: await usedSince(startOfDay()), month: await usedSince(startOfMonth()) };
}

// ---------- Sending one ----------

// What goes into the issue: the incident's details, which were already
// redacted when they were recorded (incidentRules.js)
function issueBody(incident) {
  const data = {
    title: incident.title,
    severity: incident.severity,
    source: incident.source,
    component: incident.component,
    category: incident.category,
    count: incident.count,
    message: incident.message,
    stack: incident.stack,
    description: incident.description,
    context: incident.context,
    firstSeen: incident.firstSeen,
    lastSeen: incident.lastSeen,
  };
  return `<!-- helpdesk-incident:${incident.id} -->
**Incident #${incident.id}** from the helpdesk's Maintenance page: ${incident.severity} severity, seen ${incident.count} time${incident.count === 1 ? "" : "s"}.

An AI investigation runs on this issue (\`.github/workflows/ai-investigate.yml\`). Any fix it proposes comes as a pull request for a person to review: nothing is merged or deployed automatically.

<details><summary>Incident details (secrets and personal details already removed)</summary>

\`\`\`json
${JSON.stringify(data, null, 2).replace(/```/g, "'''")}
\`\`\`
</details>`;
}

// Opens the issue (or, if there is one, asks for a new investigation on
// it). manual: an Admin pressed the button (only the monthly limit applies).
export async function sendForInvestigation(incident, { actor = null, manual = false } = {}) {
  const config = maintenanceConfig();
  if (!config.configured) throw new BadInput("AI investigations aren't set up: see docs/maintenance.md.");
  const used = await usage();
  if (used.month >= config.maxPerMonth)
    throw new BadInput(`This month's limit of ${config.maxPerMonth} AI investigations is used up (MAINT_MAX_PER_MONTH).`);
  if (!manual && used.today >= config.maxPerDay)
    throw new BadInput(`Today's limit of ${config.maxPerDay} automatic investigations is used up.`);

  await checkPrivate();
  await makeLabels();
  const github0 = incident.github ?? {};
  let issueNumber = github0.issueNumber;
  let issueUrl = github0.issueUrl;
  if (issueNumber) {
    // Investigate again: take the label off and put it back, which starts
    // the workflow again
    await github("DELETE", `/issues/${issueNumber}/labels/${LABEL}`).catch(() => {});
    await github("PATCH", `/issues/${issueNumber}`, { state: "open", body: issueBody(incident) });
    await github("POST", `/issues/${issueNumber}/labels`, { labels: [LABEL] });
  } else {
    const issue = await github("POST", "/issues", {
      title: `[Incident #${incident.id}] ${incident.title}`.slice(0, 250),
      body: issueBody(incident),
      labels: [LABEL],
    });
    issueNumber = issue.number;
    issueUrl = issue.html_url;
  }
  await db
    .update(incidents)
    .set({
      status: "investigating",
      github: { ...github0, issueNumber, issueUrl, requestedAt: Date.now() },
    })
    .where(eq(incidents.id, incident.id));
  await addIncidentEvent(incident.id, "investigation_requested", {
    actor,
    body: manual ? "Asked for an AI investigation." : "Sent for an AI investigation automatically.",
    data: { issueNumber },
  });
  return { issueNumber, issueUrl };
}

// ---------- Reading what the investigation found ----------

// The workflow's last comment on the issue ends with
// <!-- helpdesk-maintenance:{...} --> (scripts/maintenance/propose.mjs)
const RESULT = /<!-- helpdesk-maintenance:(\{[\s\S]*?\}) -->/;

async function readResult(incident) {
  const { issueNumber, requestedAt = 0, lastResultAt = 0 } = incident.github ?? {};
  if (!issueNumber) return;
  const comments = await github("GET", `/issues/${issueNumber}/comments?per_page=50&sort=created&direction=desc`);
  const latest = comments
    .filter((c) => c.user?.login === BOT && RESULT.test(c.body ?? ""))
    .map((c) => ({ at: new Date(c.created_at).getTime(), data: safeParse(c.body.match(RESULT)[1]) }))
    .filter((c) => c.data && c.data.incident === incident.id && c.at > Math.max(requestedAt, lastResultAt))
    .sort((a, b) => b.at - a.at)[0];
  if (!latest) {
    // Nothing after 2 hours: the workflow didn't run (or couldn't report)
    if (Date.now() - requestedAt > 120 * MINUTE) {
      await db
        .update(incidents)
        .set({ status: "failed", github: { ...incident.github, lastResultAt: Date.now() } })
        .where(eq(incidents.id, incident.id));
      await addIncidentEvent(incident.id, "investigation_result", {
        body: "No result after 2 hours. Check the repository's Actions tab: the workflow may not have run (see docs/maintenance.md).",
        data: { outcome: "timeout" },
      });
    }
    return;
  }
  const r = latest.data;
  const status = r.outcome === "pr" ? "awaiting_approval" : "failed";
  const text = (v, max) => String(v ?? "").slice(0, max);
  await db
    .update(incidents)
    .set({
      status,
      investigation: {
        outcome: r.outcome,
        summary: text(r.summary, 1500),
        rootCause: text(r.rootCause, 1500),
        confidence: ["low", "medium", "high"].includes(r.confidence) ? r.confidence : null,
        confirmed: (Array.isArray(r.confirmed) ? r.confirmed : []).map((x) => text(x, 500)).slice(0, 10),
        hypotheses: (Array.isArray(r.hypotheses) ? r.hypotheses : []).map((x) => text(x, 500)).slice(0, 10),
        checks: (Array.isArray(r.checks) ? r.checks : []).slice(0, 12).map((c) => ({
          name: text(c.name, 80),
          status: c.status === "passed" ? "passed" : "failed",
          optional: Boolean(c.optional),
        })),
        attempt: Number(r.attempt) || 0,
        sensitive: Boolean(r.sensitive),
        provider: text(r.provider, 40),
        model: text(r.model, 80),
      },
      github: {
        ...incident.github,
        lastResultAt: latest.at,
        prNumber: Number(r.prNumber) || null,
        prUrl: /^https:\/\/github\.com\//.test(r.prUrl ?? "") ? r.prUrl : null,
        runUrl: /^https:\/\/github\.com\//.test(r.runUrl ?? "") ? r.runUrl : null,
      },
    })
    .where(eq(incidents.id, incident.id));
  await addIncidentEvent(incident.id, "investigation_result", {
    body:
      r.outcome === "pr"
        ? `Fix proposed${r.sensitive ? " (sensitive change)" : ""}: pull request #${r.prNumber}. Waiting for a person's approval.`
        : r.outcome === "no-fix"
          ? "The investigation didn't propose a fix."
          : "The investigation or its fix failed its checks.",
    data: { outcome: r.outcome, prNumber: r.prNumber ?? null },
  });
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- In the background ----------

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

// Also run by the tests
export async function checkInvestigations() {
  return tick();
}

async function tick() {
  const config = maintenanceConfig();
  if (!config.configured) return;
  // What the running investigations found
  const running = await db
    .select()
    .from(incidents)
    .where(eq(incidents.status, "investigating"))
    .limit(20);
  for (const incident of running) await readResult(incident).catch(() => {});

  // Send the most serious one waiting, within the limits
  if (!config.auto) return;
  const waiting = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.investigate, true),
        inArray(incidents.status, ["detected"]),
        sql`${incidents.github} ->> 'issueNumber' is null`,
      ),
    )
    .orderBy(desc(incidents.lastSeen))
    .limit(20);
  const next = waiting.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9))[0];
  if (!next) return;
  const used = await usage();
  if (used.today >= config.maxPerDay || used.month >= config.maxPerMonth) return;
  await sendForInvestigation(next).catch((err) =>
    console.warn(`AI investigation of incident #${next.id} not sent: ${err.message}`),
  );
}

let started = false;
export function startInvestigations() {
  if (started || !maintenanceConfig().configured) return;
  started = true;
  const run = () =>
    tick().catch((err) => console.warn(`AI investigations: ${err.message}`));
  setTimeout(run, MINUTE).unref();
  setInterval(run, 5 * MINUTE).unref();
}

// ---------- For the Maintenance page (Admins) ----------

investigationsRouter.get("/ai-status", requireRole(...ADMINS), async (req, res) => {
  const config = maintenanceConfig();
  res.json({
    configured: config.configured,
    repo: config.configured ? config.repo : null,
    auto: config.auto,
    maxPerDay: config.maxPerDay,
    maxPerMonth: config.maxPerMonth,
    used: config.configured ? await usage() : { today: 0, month: 0 },
  });
});

investigationsRouter.post("/:id/investigate", requireRole(...ADMINS), async (req, res) => {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, Number(req.params.id) || 0));
  if (!incident) throw new BadInput("That incident doesn't exist.", 404);
  if (incident.status === "investigating")
    throw new BadInput("It's being investigated already. Results appear here within a few minutes of the run finishing.");
  const sent = await sendForInvestigation(incident, { actor: req.user, manual: true });
  res.json({ ok: true, ...sent });
});
