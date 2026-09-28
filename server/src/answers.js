// The Knowledge Base: saved answers (a problem and how it was fixed),
// written by hand or saved straight from a ticket's internal note.
// All staff can use, add, edit and delete them; customers never see them.
import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { answers, departments, tickets } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { STAFF } from "./permissions.js";
import { BadInput, cleanText } from "./validate.js";

export const answersRouter = Router();

const ms = (date) => (date ? date.getTime() : null);

// What the front end gets for an answer
function publicAnswer(a) {
  return {
    id: a.id,
    title: a.title,
    problem: a.problem,
    solution: a.solution,
    keywords: a.keywords,
    department: a.departmentId,
    ticketId: a.ticketId,
    author: a.authorName,
    source: a.source,
    uses: a.uses,
    createdAt: ms(a.createdAt),
    updatedAt: ms(a.updatedAt),
  };
}

async function findAnswer(id) {
  const [answer] = await db
    .select()
    .from(answers)
    .where(eq(answers.id, Number(id) || 0));
  if (!answer) throw new BadInput("That answer doesn't exist.", 404);
  return answer;
}

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

async function cleanDepartment(value) {
  if (value === null || value === undefined || value === "") return null;
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, String(value)));
  if (!d) throw new BadInput("That team doesn't exist.");
  return d.id;
}

async function cleanTicket(value) {
  if (value === null || value === undefined || value === "") return null;
  const [t] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, Number(value) || 0));
  return t ? t.id : null; // a ticket that's gone just isn't linked
}

// Checks the fields that were sent. `partial` = only what's there
// (when editing), otherwise title and fix are needed (when adding).
async function cleanFields(body, partial) {
  const fields = {};
  if (!partial || "title" in body)
    fields.title = cleanText(body.title, {
      label: "Title",
      max: 200,
      required: true,
    });
  if (!partial || "problem" in body)
    fields.problem = cleanText(body.problem, { label: "Problem", max: 5000 });
  if (!partial || "solution" in body)
    fields.solution = cleanText(body.solution, {
      label: "How it was fixed",
      max: 20000,
      required: true,
    });
  if (!partial || "keywords" in body)
    fields.keywords = cleanKeywords(body.keywords);
  if (!partial || "department" in body)
    fields.departmentId = await cleanDepartment(body.department);
  return fields;
}

// Everything, most recently updated first
answersRouter.get("/", requireRole(...STAFF), async (req, res) => {
  const list = await db.select().from(answers).orderBy(desc(answers.updatedAt));
  res.json(list.map(publicAnswer));
});

// A new answer, written by hand or saved from a ticket's note
answersRouter.post("/", requireRole(...STAFF), async (req, res) => {
  const body = req.body ?? {};
  const now = new Date();
  const [created] = await db
    .insert(answers)
    .values({
      ...(await cleanFields(body, false)),
      ticketId: await cleanTicket(body.ticketId),
      source: body.source === "note" ? "note" : "manual",
      authorName: req.user.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  res.status(201).json(publicAnswer(created));
});

// Change an answer
answersRouter.patch("/:id", requireRole(...STAFF), async (req, res) => {
  const answer = await findAnswer(req.params.id);
  const fields = await cleanFields(req.body ?? {}, true);
  const [updated] = await db
    .update(answers)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(answers.id, answer.id))
    .returning();
  res.json(publicAnswer(updated));
});

// Delete an answer (the ticket it came from isn't touched)
answersRouter.delete("/:id", requireRole(...STAFF), async (req, res) => {
  const answer = await findAnswer(req.params.id);
  await db.delete(answers).where(eq(answers.id, answer.id));
  res.json({ ok: true });
});

// Someone copied the fix: count it, so the most useful answers rise to
// the top ("Most used")
answersRouter.post("/:id/use", requireRole(...STAFF), async (req, res) => {
  const answer = await findAnswer(req.params.id);
  const [updated] = await db
    .update(answers)
    .set({ uses: sql`${answers.uses} + 1` })
    .where(eq(answers.id, answer.id))
    .returning();
  res.json(publicAnswer(updated));
});
