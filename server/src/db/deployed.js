// After an update (deploy/update.sh): the Maintenance page's incidents
// follow along.
//
//   node --env-file=.env src/db/deployed.js deployed <commit>
//       approved fixes whose merge is in <commit> become "deployed"
//   node --env-file=.env src/db/deployed.js rolled-back <from> <to>
//       fixes marked deployed by the update to <to> become "rolled back"
//
// "Verified" comes later, by itself: a deployed fix whose error hasn't
// happened again for 7 days (incidents.js). If it does happen again, the
// incident opens again.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "./index.js";
import { incidentEvents, incidents } from "./schema.js";

const repo = path.resolve(import.meta.dirname, "../../..");
const isCommit = (s) => /^[0-9a-f]{40}$/.test(String(s ?? ""));

// Is <ancestor> part of <head>?
function contains(ancestor, head) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, head], { cwd: repo, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function event(incidentId, type, body, data = {}) {
  await db.insert(incidentEvents).values({ incidentId, type, actorName: "Deploy", body, data });
}

async function deployed(commit) {
  const approved = await db.select().from(incidents).where(eq(incidents.status, "approved"));
  let n = 0;
  for (const incident of approved) {
    const sha = incident.github?.mergeSha;
    if (!isCommit(sha) || !contains(sha, commit)) continue;
    await db
      .update(incidents)
      .set({
        status: "deployed",
        github: { ...incident.github, deployedSha: commit, deployedAt: new Date().toISOString() },
      })
      .where(eq(incidents.id, incident.id));
    await event(
      incident.id,
      "deployed",
      `Deployed: the fix is live (version ${commit.slice(0, 7)}). If the error doesn't happen again for 7 days, it's marked verified.`,
      { commit },
    );
    n += 1;
  }
  console.log(`${n} fix(es) marked as deployed.`);
}

async function rolledBack(from, to) {
  const live = await db.select().from(incidents).where(eq(incidents.status, "deployed"));
  let n = 0;
  for (const incident of live) {
    if (incident.github?.deployedSha !== to) continue;
    await db
      .update(incidents)
      .set({ status: "rolled_back", github: { ...incident.github, rolledBackTo: from } })
      .where(eq(incidents.id, incident.id));
    await event(
      incident.id,
      "rolled_back",
      `Rolled back: the update to ${to.slice(0, 7)} failed its checks, so the helpdesk went back to ${from.slice(0, 7)}. The fix is merged but not live.`,
      { from, to },
    );
    n += 1;
  }
  console.log(`${n} fix(es) marked as rolled back.`);
}

const [what, a, b] = process.argv.slice(2);
try {
  if (what === "deployed" && isCommit(a)) await deployed(a);
  else if (what === "rolled-back" && isCommit(a) && isCommit(b)) await rolledBack(a, b);
  else throw new Error("Use: deployed.js deployed <commit> | rolled-back <from> <to>");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
