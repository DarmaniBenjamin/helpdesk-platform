// How the helpdesk is set up: assignment rules, automations and settings.
//   Rules and automations: Admins and the Super Admin.
//   Settings (backups, the Freshdesk connection): the Super Admin only.
// (Rules and automations are saved and shown, but don't run on their own
// yet; that comes later.)
import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  rules,
  automations,
  settings,
  departments,
  users,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput, cleanText } from "./validate.js";

// ---------- Shared checks ----------

// Keywords: lowercase, no blanks or repeats, at most 20
function cleanKeywords(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((k) =>
          String(k ?? "")
            .trim()
            .toLowerCase()
            .slice(0, 40),
        )
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

async function cleanDepartment(value, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new BadInput("Pick a team.");
    return null;
  }
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, String(value)));
  if (!d) throw new BadInput("That team doesn't exist.");
  return d.id;
}

// Only active staff can be given tickets
async function cleanAgent(value) {
  if (value === null || value === undefined || value === "") return null;
  const [u] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, String(value)));
  if (!u || u.status !== "active" || !STAFF.includes(u.role))
    throw new BadInput("That person can't be given tickets.");
  return u.id;
}

async function findRow(table, id, what) {
  const [row] = await db
    .select()
    .from(table)
    .where(eq(table.id, Number(id) || 0));
  if (!row) throw new BadInput(`That ${what} doesn't exist.`, 404);
  return row;
}

// ================================================================
// Assignment rules:  /api/rules
// ================================================================

export const rulesRouter = Router();

function publicRule(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    keywords: r.keywords,
    department: r.departmentId,
    agent: r.agentId,
    enabled: r.enabled,
  };
}

async function cleanRule(body, partial) {
  const fields = {};
  if (!partial || "name" in body)
    fields.name = cleanText(body.name, {
      label: "Rule name",
      max: 100,
      required: true,
    });
  if (!partial || "description" in body)
    fields.description = cleanText(body.description, {
      label: "Description",
      max: 500,
    });
  if (!partial || "keywords" in body) {
    fields.keywords = cleanKeywords(body.keywords);
    if (fields.keywords.length === 0)
      throw new BadInput("Add at least one keyword.");
  }
  if (!partial || "department" in body)
    fields.departmentId = await cleanDepartment(body.department, {
      required: true,
    });
  if (!partial || "agent" in body)
    fields.agentId = await cleanAgent(body.agent);
  if ("enabled" in body) fields.enabled = Boolean(body.enabled);
  return fields;
}

rulesRouter.get("/", requireRole(...ADMINS), async (req, res) => {
  const list = await db.select().from(rules).orderBy(asc(rules.id));
  res.json(list.map(publicRule));
});

rulesRouter.post("/", requireRole(...ADMINS), async (req, res) => {
  const [created] = await db
    .insert(rules)
    .values(await cleanRule(req.body ?? {}, false))
    .returning();
  res.status(201).json(publicRule(created));
});

rulesRouter.patch("/:id", requireRole(...ADMINS), async (req, res) => {
  const rule = await findRow(rules, req.params.id, "rule");
  const fields = await cleanRule(req.body ?? {}, true);
  const [updated] = Object.keys(fields).length
    ? await db
        .update(rules)
        .set(fields)
        .where(eq(rules.id, rule.id))
        .returning()
    : [rule];
  res.json(publicRule(updated));
});

rulesRouter.delete("/:id", requireRole(...ADMINS), async (req, res) => {
  const rule = await findRow(rules, req.params.id, "rule");
  await db.delete(rules).where(eq(rules.id, rule.id));
  res.json({ ok: true });
});

// ================================================================
// Automations:  /api/automations
// ================================================================

export const automationsRouter = Router();

// The same choices as the front end's src/Components/automationOptions.js
const TRIGGERS = [
  "created",
  "customerReply",
  "statusChanged",
  "noCustomerReply",
  "noAgentReply",
  "resolvedFor",
];
const ACTIONS = [
  "setStatus",
  "setPriority",
  "assignTeam",
  "assignAgent",
  "emailCustomer",
  "notifyTeam",
  "addNote",
  "addTag",
];

// A trigger or action's extra detail: a status, priority, number of
// hours, a bit of text... Kept short and simple.
function cleanValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return String(value).slice(0, 2000);
}

function publicAutomation(a) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    trigger: a.trigger,
    actions: a.actions,
    enabled: a.enabled,
    runs: a.runs,
  };
}

function cleanAutomation(body, partial) {
  const fields = {};
  if (!partial || "name" in body)
    fields.name = cleanText(body.name, {
      label: "Automation name",
      max: 100,
      required: true,
    });
  if (!partial || "description" in body)
    fields.description = cleanText(body.description, {
      label: "Description",
      max: 500,
    });
  if (!partial || "trigger" in body) {
    const type = String(body.trigger?.type ?? "");
    if (!TRIGGERS.includes(type)) throw new BadInput("Pick what starts it.");
    fields.trigger = { type, value: cleanValue(body.trigger.value) };
  }
  if (!partial || "actions" in body) {
    if (!Array.isArray(body.actions) || body.actions.length === 0)
      throw new BadInput("Add at least one thing for it to do.");
    fields.actions = body.actions.slice(0, 10).map((a) => {
      const type = String(a?.type ?? "");
      if (!ACTIONS.includes(type))
        throw new BadInput("One of the actions isn't valid.");
      return { type, value: cleanValue(a.value) };
    });
  }
  if ("enabled" in body) fields.enabled = Boolean(body.enabled);
  return fields;
}

automationsRouter.get("/", requireRole(...ADMINS), async (req, res) => {
  const list = await db.select().from(automations).orderBy(asc(automations.id));
  res.json(list.map(publicAutomation));
});

automationsRouter.post("/", requireRole(...ADMINS), async (req, res) => {
  const [created] = await db
    .insert(automations)
    .values(cleanAutomation(req.body ?? {}, false))
    .returning();
  res.status(201).json(publicAutomation(created));
});

automationsRouter.patch("/:id", requireRole(...ADMINS), async (req, res) => {
  const automation = await findRow(automations, req.params.id, "automation");
  const fields = cleanAutomation(req.body ?? {}, true);
  const [updated] = Object.keys(fields).length
    ? await db
        .update(automations)
        .set(fields)
        .where(eq(automations.id, automation.id))
        .returning()
    : [automation];
  res.json(publicAutomation(updated));
});

automationsRouter.delete("/:id", requireRole(...ADMINS), async (req, res) => {
  const automation = await findRow(automations, req.params.id, "automation");
  await db.delete(automations).where(eq(automations.id, automation.id));
  res.json({ ok: true });
});

// ================================================================
// Settings:  /api/settings  (Super Admin only)
// ================================================================

export const settingsRouter = Router();

// What each section holds, with the value used until it's changed.
// Only these can be saved, so nothing unexpected ends up in here.
// (The Freshdesk API key is never saved: it's typed in each time.)
const DEFAULTS = {
  backup: {
    destination: "download", // "download", "gdrive" or "b2"
    schedule: "daily", // "off", "daily" or "weekly"
    keep: 14, // how many old backups to keep
    lastBackupAt: null,
  },
  freshdesk: {
    domain: "", // e.g. "protonic" for protonic.freshdesk.com
  },
};

function cleanSection(section, changes) {
  const clean = {};
  if (section === "backup") {
    if ("destination" in changes) {
      if (!["download", "gdrive", "b2"].includes(changes.destination))
        throw new BadInput("That backup destination isn't valid.");
      clean.destination = changes.destination;
    }
    if ("schedule" in changes) {
      if (!["off", "daily", "weekly"].includes(changes.schedule))
        throw new BadInput("That backup schedule isn't valid.");
      clean.schedule = changes.schedule;
    }
    if ("keep" in changes) {
      const keep = Number(changes.keep);
      if (!Number.isInteger(keep) || keep < 1 || keep > 365)
        throw new BadInput("Keep between 1 and 365 backups.");
      clean.keep = keep;
    }
    if ("lastBackupAt" in changes) {
      const at = Number(changes.lastBackupAt);
      clean.lastBackupAt = Number.isFinite(at) ? at : null;
    }
  } else if (section === "freshdesk") {
    if ("domain" in changes) {
      const domain = String(changes.domain ?? "")
        .trim()
        .toLowerCase();
      if (domain && !/^[a-z0-9-]+$/.test(domain))
        throw new BadInput(
          "Use just the first part of the address, e.g. protonic.",
        );
      clean.domain = domain;
    }
  } else {
    throw new BadInput("That settings section doesn't exist.", 404);
  }
  return clean;
}

// All settings, with defaults filled in for anything not saved yet
async function loadSettings() {
  const rows = await db.select().from(settings);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, defaults]) => [
      key,
      { ...defaults, ...(saved[key] ?? {}) },
    ]),
  );
}

settingsRouter.get("/", requireRole("owner"), async (req, res) => {
  res.json(await loadSettings());
});

// Change part of one section, e.g. PATCH /api/settings/backup
// with { "schedule": "weekly" }. Returns all the settings.
settingsRouter.patch("/:section", requireRole("owner"), async (req, res) => {
  const section = req.params.section;
  const changes = cleanSection(section, req.body ?? {});
  const current = (await loadSettings())[section];
  const value = { ...current, ...changes };
  await db
    .insert(settings)
    .values({ key: section, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  res.json(await loadSettings());
});
