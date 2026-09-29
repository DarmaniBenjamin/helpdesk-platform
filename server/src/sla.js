// SLA targets: how fast each priority must get a first reply, and be
// resolved, in hours. They set the due times on every new ticket, and
// the Performance page measures the team against them.
//
//   GET   /api/sla   the targets (anyone signed in)
//   PATCH /api/sla   change them (Admins and the Super Admin), e.g.
//                    { "4": { "firstResponse": 1, "resolve": 4 } }
//
// They're kept in the settings table (key "sla"), so backups include
// them. Changing them only affects tickets made afterwards: tickets that
// already exist keep the due times they were given.
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { requireAuth, requireRole } from "./auth.js";
import { ADMINS } from "./permissions.js";
import { BadInput } from "./validate.js";

export const slaRouter = Router();

// Priority 1 Low ... 4 Urgent, in hours
export const DEFAULT_SLA = {
  1: { firstResponse: 8, resolve: 72 },
  2: { firstResponse: 4, resolve: 24 },
  3: { firstResponse: 2, resolve: 8 },
  4: { firstResponse: 1, resolve: 4 },
};
const PRIORITY_NAMES = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };
const MAX_HOURS = 90 * 24; // 90 days

// Kept in memory after the first read, so making a ticket doesn't need
// an extra trip to the database. Updated whenever they're changed.
let cached = null;

// The targets, with the defaults filled in for anything not changed
export async function getSla() {
  if (cached) return cached;
  const [row] = await db.select().from(settings).where(eq(settings.key, "sla"));
  const saved = row?.value ?? {};
  cached = Object.fromEntries(
    Object.entries(DEFAULT_SLA).map(([p, defaults]) => [
      p,
      { ...defaults, ...(saved[p] ?? {}) },
    ]),
  );
  return cached;
}

// After a restore the settings table changes underneath: read it again
export function forgetSla() {
  cached = null;
}

// A number of hours: at least a quarter of an hour, at most 90 days,
// rounded to quarter hours (15 minutes)
function cleanHours(value, label) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0.25 || hours > MAX_HOURS)
    throw new BadInput(`${label} must be between 15 minutes and 90 days.`);
  return Math.round(hours * 4) / 4;
}

slaRouter.get("/", requireAuth, async (req, res) => {
  res.json(await getSla());
});

slaRouter.patch("/", requireRole(...ADMINS), async (req, res) => {
  const current = await getSla();
  const next = structuredClone(current);
  for (const [p, changes] of Object.entries(req.body ?? {})) {
    if (!DEFAULT_SLA[p] || typeof changes !== "object" || !changes)
      throw new BadInput("That priority doesn't exist.");
    const name = PRIORITY_NAMES[p];
    if ("firstResponse" in changes)
      next[p].firstResponse = cleanHours(
        changes.firstResponse,
        `${name}: first reply`,
      );
    if ("resolve" in changes)
      next[p].resolve = cleanHours(changes.resolve, `${name}: resolve`);
    if (next[p].firstResponse > next[p].resolve)
      throw new BadInput(
        `${name}: the first reply can't be due after the ticket should be resolved.`,
      );
  }
  await db
    .insert(settings)
    .values({ key: "sla", value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } });
  cached = next;
  res.json(next);
});
