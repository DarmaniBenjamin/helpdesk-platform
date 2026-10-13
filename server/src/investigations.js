// Maintenance, stage 3: sending incidents for an AI investigation, and
// reading what it found. The investigation itself never runs here: this
// file only opens a GitHub issue with the incident's (already redacted)
// details and labels it "ai-investigate". GitHub Actions does the rest
// (.github/workflows/ai-investigate.yml) and reports back on the issue.
//
// It's set up in the helpdesk: Maintenance → AI & GitHub (Super Admin,
// maintenanceSettings.js). Until it's set up there, all of this is off and
// the helpdesk works exactly the same. (Older setups can still use these
// lines in server/.env instead:)
//
//   MAINT_GITHUB_REPO=owner/repo        the (private) repository
//   MAINT_GITHUB_TOKEN=github_pat_...   fine-grained token: Issues read/write only
//   MAINT_AUTO_INVESTIGATE=on           send incidents worth it by themselves (off: only the button)
//   MAINT_MAX_PER_DAY=3                 investigations started by themselves per day
//   MAINT_MAX_PER_MONTH=20              all investigations per month, the button included
//   MAINT_ALLOW_PUBLIC_REPO=no          incidents are never sent to a public repository
//
//   MAINT_GITHUB_WEBHOOK_SECRET=...     stage 4: GitHub tells the helpdesk at once when a
//                                       fix is merged or closed (else it checks every 5 minutes)
//   MAINT_APPROVERS=login1,login2       optional: GitHub accounts whose merge counts as approval
//
//   GET  /api/incidents/ai-status           settings and this month's use (Admins)
//   POST /api/incidents/:id/investigate     investigate now / again (Admins)
//   POST /api/maintenance/github-webhook    GitHub's events (signed: no sign-in)
//
// Approval (stage 4) is a person merging the fix's pull request on
// GitHub: the incident becomes "approved", with who merged it and the
// commit, ready for the deploy (stage 5). Closed without merging:
// "rejected". Nothing here can merge anything.
import crypto from "node:crypto";
import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { incidentEvents, incidents } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS } from "./permissions.js";
import { BadInput } from "./validate.js";
import { addIncidentEvent } from "./incidents.js";
import {
  githubToken,
  maintenanceConfig,
  prepareAiForInvestigation,
  refreshConfig,
} from "./maintenanceSettings.js";

export const investigationsRouter = Router();
export const githubWebhookRouter = Router();

const MINUTE = 60 * 1000;
const LABEL = "ai-investigate";
const LABELS = [
  [LABEL, "5319e7", "The helpdesk asked for an AI investigation"],
  ["ai-fix", "0e8a16", "A fix proposed by the AI investigation"],
  ["sensitive-change", "b60205", "Touches sign-in, permissions, secrets or deleting data: never auto-approve"],
  ["ai-no-fix", "fbca04", "The AI investigation didn't propose a fix"],
  ["ai-failed", "d93f0b", "The AI investigation or its fix failed"],
  ["low-risk", "c2e0c6", "Small, confident, fully checked fix: still needs a person"],
];
// Only the workflow's own comments are believed
const BOT = "github-actions[bot]";

export { maintenanceConfig };

// ---------- GitHub ----------

async function github(method, url, body) {
  const { repo } = maintenanceConfig();
  const token = await githubToken();
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
      `${config.repo} is public: incidents won't be sent to it. Make it private first, or while testing, turn on "Allow a public repository" (Maintenance → AI & GitHub).`,
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
function issueBody(incident, ai = {}) {
  const data = {
    // Which AI investigates (set in Maintenance → AI & GitHub)
    ai,
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
  if (!config.configured)
    throw new BadInput("AI investigations aren't set up: Maintenance → AI & GitHub.");
  const used = await usage();
  if (used.month >= config.maxPerMonth)
    throw new BadInput(`This month's limit of ${config.maxPerMonth} AI investigations is used up (MAINT_MAX_PER_MONTH).`);
  if (!manual && used.today >= config.maxPerDay)
    throw new BadInput(`Today's limit of ${config.maxPerDay} automatic investigations is used up.`);

  await checkPrivate();
  await makeLabels();
  // The chosen AI's key where the workflow can use it (for "Continue with
  // ChatGPT", a fresh access token)
  const ai = await prepareAiForInvestigation();
  const github0 = incident.github ?? {};
  let issueNumber = github0.issueNumber;
  let issueUrl = github0.issueUrl;
  if (issueNumber) {
    // Investigate again: take the label off and put it back, which starts
    // the workflow again
    await github("DELETE", `/issues/${issueNumber}/labels/${LABEL}`).catch(() => {});
    await github("PATCH", `/issues/${issueNumber}`, { state: "open", body: issueBody(incident, ai) });
    await github("POST", `/issues/${issueNumber}/labels`, { labels: [LABEL] });
  } else {
    const issue = await github("POST", "/issues", {
      title: `[Incident #${incident.id}] ${incident.title}`.slice(0, 250),
      body: issueBody(incident, ai),
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

  // Fixes waiting for approval: merged or closed on GitHub? (The webhook
  // says so at once; this catches anything it missed. Needs the token to
  // have Pull requests: Read too, else it's skipped.)
  if (pullsReadable) {
    const waitingApproval = await db
      .select()
      .from(incidents)
      .where(eq(incidents.status, "awaiting_approval"))
      .limit(20);
    for (const incident of waitingApproval) {
      const n = incident.github?.prNumber;
      if (!n) continue;
      try {
        await applyPullRequest(incident, await github("GET", `/pulls/${n}`));
      } catch (err) {
        if (err.githubStatus === 403) {
          pullsReadable = false;
          console.warn("AI investigations: the token can't read pull requests, so only the webhook updates approvals.");
        }
      }
    }
  }

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

// ---------- Approval: the fix's pull request merged or closed ----------

let pullsReadable = true;
const APPROVED_OR_LATER = ["approved", "deployed", "verified"];

// The incident a pull request is the fix for. Both must agree: the
// incident's number in the PR, and the PR's number on the incident, so no
// other pull request can change an incident.
async function incidentForPullRequest(pr) {
  const id = Number(String(pr?.body ?? "").match(/<!-- helpdesk-incident:(\d+) -->/)?.[1] ?? 0);
  if (!id) return null;
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, id));
  if (!incident || Number(incident.github?.prNumber) !== Number(pr.number)) return null;
  return incident;
}

// Updates the incident from the pull request's state
export async function applyPullRequest(incident, pr, sender = null) {
  const config = maintenanceConfig();
  if (pr.state === "closed" && (pr.merged || pr.merged_at)) {
    if (APPROVED_OR_LATER.includes(incident.status)) return;
    const login = String(pr.merged_by?.login ?? sender ?? "").toLowerCase();
    const warnings = [];
    if (!login || login.endsWith("[bot]"))
      warnings.push("It was merged by an automated account, not a person: check who allowed that.");
    else if (config.approvers.length && !config.approvers.includes(login))
      warnings.push(`${login} isn't on the approvers list (MAINT_APPROVERS).`);
    await db
      .update(incidents)
      .set({
        status: "approved",
        github: {
          ...incident.github,
          mergedBy: login || null,
          mergedAt: pr.merged_at ?? new Date().toISOString(),
          mergeSha: /^[0-9a-f]{40}$/.test(pr.merge_commit_sha ?? "") ? pr.merge_commit_sha : null,
          approvalWarnings: warnings,
        },
      })
      .where(eq(incidents.id, incident.id));
    await addIncidentEvent(incident.id, "approved", {
      actor: { name: login ? `${login} (GitHub)` : "GitHub" },
      body: `Approved: pull request #${pr.number} was merged. It goes live with the next deploy.${warnings.length ? ` Warning: ${warnings.join(" ")}` : ""}`,
      data: { prNumber: pr.number, mergeSha: pr.merge_commit_sha ?? null },
    });
  } else if (pr.state === "closed") {
    if (incident.status !== "awaiting_approval") return;
    await db.update(incidents).set({ status: "rejected" }).where(eq(incidents.id, incident.id));
    await addIncidentEvent(incident.id, "rejected", {
      actor: sender ? { name: `${sender} (GitHub)` } : null,
      body: `Rejected: pull request #${pr.number} was closed without merging.`,
      data: { prNumber: pr.number },
    });
  } else if (pr.state === "open" && incident.status === "rejected") {
    await db.update(incidents).set({ status: "awaiting_approval" }).where(eq(incidents.id, incident.id));
    await addIncidentEvent(incident.id, "pr_reopened", {
      actor: sender ? { name: `${sender} (GitHub)` } : null,
      body: `Pull request #${pr.number} was reopened: waiting for approval again.`,
    });
  }
}

// ---------- GitHub's webhook ----------

// Each delivery is handled once, even if GitHub sends it again
const deliveries = new Set();

export function signedByGitHub(req, secret) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const given = String(req.get("x-hub-signature-256") ?? "");
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

export async function handleGitHubEvent(event, payload) {
  const config = maintenanceConfig();
  if (String(payload?.repository?.full_name ?? "").toLowerCase() !== config.repo.toLowerCase())
    return "not this repository";
  const sender = payload.sender?.login ?? null;
  if (event === "pull_request" && ["closed", "reopened"].includes(payload.action)) {
    const incident = await incidentForPullRequest(payload.pull_request);
    if (!incident) return "not a fix for an incident";
    await applyPullRequest(incident, payload.pull_request, sender);
    return "updated";
  }
  if (event === "pull_request_review" && payload.action === "submitted") {
    const incident = await incidentForPullRequest(payload.pull_request);
    if (!incident) return "not a fix for an incident";
    const state = String(payload.review?.state ?? "").toLowerCase();
    const said = { approved: "approved it", changes_requested: "asked for changes", commented: "commented" };
    await addIncidentEvent(incident.id, "review", {
      actor: sender ? { name: `${sender} (GitHub)` } : null,
      body: `Review on pull request #${payload.pull_request.number}: ${said[state] ?? state}. (Approval is merging it.)`,
    });
    return "noted";
  }
  if (event === "issue_comment" && payload.action === "created" && payload.comment?.user?.login === BOT) {
    // The investigation just reported: read it now instead of in 5 minutes
    const [incident] = await db
      .select()
      .from(incidents)
      .where(sql`(${incidents.github} ->> 'issueNumber')::int = ${Number(payload.issue?.number) || 0}`);
    if (incident?.status === "investigating") await readResult(incident);
    return "read";
  }
  return "ignored";
}

githubWebhookRouter.post("/", async (req, res) => {
  const config = maintenanceConfig();
  if (!config.configured || !config.webhookSecret)
    return res.status(404).json({ error: "Not set up." });
  if (!signedByGitHub(req, config.webhookSecret))
    return res.status(401).json({ error: "Not signed with this webhook's secret." });
  const delivery = String(req.get("x-github-delivery") ?? "");
  if (delivery && deliveries.has(delivery)) return res.status(202).json({ ok: true, result: "already had it" });
  if (delivery) {
    deliveries.add(delivery);
    if (deliveries.size > 1000) deliveries.delete(deliveries.values().next().value);
  }
  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Not JSON." });
  }
  const event = String(req.get("x-github-event") ?? "");
  if (event === "ping") return res.json({ ok: true, result: "pong" });
  // Answer at once (GitHub waits 10 seconds at most), then do it
  res.status(202).json({ ok: true });
  handleGitHubEvent(event, payload).catch((err) =>
    console.warn(`GitHub webhook (${event}): ${err.message}`),
  );
});

let started = false;
export function startInvestigations() {
  if (started) return;
  started = true;
  // The saved settings (Maintenance → AI & GitHub); it does nothing until
  // they're set up
  refreshConfig().catch((err) => console.warn(`Maintenance settings: ${err.message}`));
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
    webhook: Boolean(config.webhookSecret),
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
