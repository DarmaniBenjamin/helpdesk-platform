// The history lines on a ticket ("assigned the ticket to Alex").
//
// Every change is recorded, but only the important ones show inside the
// ticket: when it was created, who it was assigned to, and when it was
// resolved or closed. Everything else (a note deleted, the priority or
// team changed, a tag added...) doesn't clutter the conversation:
// instead, whoever it concerns gets it as a notification in the bell.
// It's still saved, so nothing is lost (e.g. in backups).
import { db } from "./db/index.js";
import { messages } from "./db/schema.js";
import { notify } from "./notify.js";

// The kinds of history line shown inside the ticket
const SHOWN = new Set([
  "created",
  "assigned",
  "status:resolved",
  "status:closed",
]);

// History lines saved before kinds existed: shown if they're one of the
// important ones, going by what they say
const OLD_SHOWN =
  /^(took the ticket|assigned the ticket|unassigned the ticket|sent it to|assigned it to|changed status to (Resolved|Closed))/;

// Is this history line shown inside the ticket?
export function isShownEvent(m) {
  if (m.kind !== "event") return true;
  if (m.eventType) return SHOWN.has(m.eventType);
  return OLD_SHOWN.test(m.body);
}

// Records a history line on a ticket.
//   ticket   the ticket (its id, subject and assigneeId are used)
//   actor    who did it: { id, name } (id is null for rules/automations)
//   type     "created", "assigned", "status:closed", "priority", ...
//   body     e.g. "changed priority to Urgent"
//   alsoTell other people to notify, e.g. the writer of a deleted note
//   tx       pass a transaction to save it as part of that
// Lines that don't show in the ticket are sent as notifications to the
// person who has the ticket (and alsoTell), never to whoever did it.
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
  if (SHOWN.has(type)) return;

  const people = [ticket.assigneeId, ...alsoTell].filter(
    (id) => id && id !== actor.id,
  );
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
