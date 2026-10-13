// Did CI (.github/workflows/ci.yml) pass for this commit? Asked by
// deploy/update.sh before it deploys anything.
//
//   node deploy/ci-status.mjs <commit>
//
// Prints one line, and exits with:
//   0 passed   1 failed   2 still running   3 can't tell
//
// It reads MAINT_GITHUB_REPO and MAINT_GITHUB_TOKEN from server/.env. The
// token needs "Checks: Read-only" as well as Issues (docs/maintenance.md).
// Without them it says it can't tell, and update.sh asks before going on.
import fs from "node:fs";
import path from "node:path";

const sha = process.argv[2] ?? "";
const say = (code, line) => {
  console.log(line);
  process.exit(code);
};
if (!/^[0-9a-f]{40}$/.test(sha)) say(3, "No commit given.");

const envFile = path.resolve(import.meta.dirname, "../server/.env");
const env = {};
try {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {
  // no settings file: can't tell
}
const repo = env.MAINT_GITHUB_REPO;
const token = env.MAINT_GITHUB_TOKEN;
if (!repo || !token)
  say(3, "Can't check CI: MAINT_GITHUB_REPO and MAINT_GITHUB_TOKEN aren't in server/.env.");

let res;
try {
  res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?check_name=checks&per_page=20`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });
} catch {
  say(3, "Can't check CI: GitHub didn't answer.");
}
if (res.status === 403 || res.status === 404)
  say(3, "Can't check CI: the token needs Checks: Read-only (docs/maintenance.md).");
if (!res.ok) say(3, `Can't check CI: GitHub said ${res.status}.`);
const runs = (await res.json()).check_runs ?? [];
if (!runs.length) say(2, "CI hasn't started for this commit yet.");
// The newest run of the "checks" job decides
const run = runs.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
if (run.status !== "completed") say(2, `CI is still running: ${run.html_url}`);
if (run.conclusion === "success") say(0, "CI passed.");
say(1, `CI didn't pass (${run.conclusion}): ${run.html_url}`);
