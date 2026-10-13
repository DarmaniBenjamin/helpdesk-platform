// Did CI (.github/workflows/ci.yml) pass for this commit? Asked by
// deploy/update.sh before it deploys anything.
//
//   cd server && node --env-file=.env ../deploy/ci-status.mjs <commit>
//
// Prints one line, and exits with:
//   0 passed   1 failed   2 still running   3 can't tell
//
// It uses the GitHub connection set up in the helpdesk (Maintenance → AI &
// GitHub), or for older setups MAINT_GITHUB_REPO / MAINT_GITHUB_TOKEN in
// server/.env. Without one, it says it can't tell, and update.sh asks
// before going on.
const sha = process.argv[2] ?? "";
const say = (code, line) => {
  console.log(line);
  process.exit(code);
};
if (!/^[0-9a-f]{40}$/.test(sha)) say(3, "No commit given.");

let repo = "";
let token = "";
try {
  const settings = await import("../server/src/maintenanceSettings.js");
  await settings.refreshConfig();
  const config = settings.maintenanceConfig();
  repo = config.repo;
  if (config.configured) token = await settings.githubToken();
} catch {
  // the database or GitHub can't be reached: can't tell
}
if (!repo || !token)
  say(3, "Can't check CI: GitHub isn't connected in the helpdesk (Maintenance → AI & GitHub).");

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
  say(3, "Can't check CI: the GitHub connection can't read checks (Maintenance → AI & GitHub → Test connection).");
if (!res.ok) say(3, `Can't check CI: GitHub said ${res.status}.`);
const runs = (await res.json()).check_runs ?? [];
if (!runs.length) say(2, "CI hasn't started for this commit yet.");
// The newest run of the "checks" job decides
const run = runs.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
if (run.status !== "completed") say(2, `CI is still running: ${run.html_url}`);
if (run.conclusion === "success") say(0, "CI passed.");
say(1, `CI didn't pass (${run.conclusion}): ${run.html_url}`);
