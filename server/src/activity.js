// The history of changes on a ticket ("assigned the ticket to Alex",
// "changed status to Closed (from Resolved)"...).
//
// None of it shows inside the ticket: the conversation only has the
// messages and notes. Instead, each change goes to the bell (and
// desktop/phone notifications) of the people involved: whoever has the
// ticket, whoever made the change, and anyone else it concerns (e.g.
// the person a ticket was taken from, or the writer of a deleted note).
// Every change is still saved, so nothing is lost: Ticket Review uses
// it to show who closed a ticket, and backups keep it.
import { db } from "./db/index.js";
import { messages } from "./db/schema.js";
import { notify } from "./notify.js";

// Records a change on a ticket, and tells the people involved.
//   ticket   the ticket, as it is after the change (its id, subject and
//            assigneeId are used)
//   actor    who did it: { id, name } (id is null for rules/automations)
//   type     "created", "assigned", "status:closed", "priority", ...
//   body     e.g. "changed priority to Urgent"
//   alsoTell other people to notify, e.g. the writer of a deleted note
//   tx       pass a transaction to save it as part of that
export async function recordEvent({
  ticket,
  actor,
  type,
  body,
  alsoTell = [],
  at = new Date(),
  tx = db,
}) {
  await tx.insert(messages).values({
    ticketId: ticket.id,
    kind: "event",
    eventType: type,
    authorId: actor.id ?? null,
    authorName: actor.name,
    body,
    createdAt: at,
  });

  // A new ticket: the Admins already get "New ticket" (notify.js)
  if (type === "created") return;

  let people = [ticket.assigneeId, ...alsoTell, actor.id];
  // Assigning: the person it's now assigned to gets "assigned to you"
  // (notify.js), so they aren't told twice
  if (type === "assigned")
    people = people.filter((id) => id !== ticket.assigneeId);
  people = [...new Set(people.filter(Boolean))];
  if (people.length === 0) return;

  // After the change is saved, and never holding it up
  setTimeout(() => {
    notify(people, {
      kind: "activity",
      title: `#${ticket.id} ${ticket.subject}`.slice(0, 120),
      body: `${actor.name} ${body}`,
      ticketId: ticket.id,
    }).catch((err) => console.error("Activity notification:", err));
  }, 0);
}
