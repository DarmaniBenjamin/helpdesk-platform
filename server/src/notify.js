// Notifications: the bell in the top bar, and real desktop/phone
// notifications (the kind that show up in the Windows notification
// centre, even when the helpdesk tab is closed).
//
// Who gets what (only active staff, never customers):
//   - A new ticket or request comes in   -> Admins and the Super Admin
//   - A ticket is assigned to you        -> you (also when you took it yourself)
//   - A customer replies on your ticket  -> you, or the Admins if nobody has it
//   - Your ticket is due within an hour  -> you, or the Admins if nobody has it
//   - Your ticket is overdue             -> you, or the Admins if nobody has it
//   - Any other change to a ticket       -> see activity.js
//
// Each notification is saved (so the bell keeps it), sent down the live
// connection to any open tab (live.js), and pushed to every browser the
// person turned notifications on in ("web push").
//
// Web push needs a key pair ("VAPID keys"). It's made by itself the
// first time it's needed and kept in the settings table, the private
// half locked with this server's key (secrets.js). Nothing to put in
// server/.env. (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in server/.env
// still work, and win, for anyone who already set them.)
import { Router } from "express";
import webpush from "web-push";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notInArray,
} from "drizzle-orm";
import { db } from "./db/index.js";
import {
  notifications,
  pushSubscriptions,
  settings,
  tickets,
  customers,
  users,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput } from "./validate.js";
import { sendToUser } from "./live.js";
import { seal, unseal } from "./secrets.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// ---------- Web push setup ----------

// The key pair, set up once and then remembered. Returns the public key
// (browsers need it to sign up), or null if it couldn't be set up.
let vapid = null;
function pushKeys() {
  vapid ??= setUpPushKeys().catch((err) => {
    vapid = null; // try again next time
    console.error("Setting up notifications failed:", err.message);
    return null;
  });
  return vapid;
}

async function setUpPushKeys() {
  // Who the push services can contact about this server
  const subject = `mailto:${
    process.env.VAPID_SUBJECT?.replace(/^mailto:/, "") ||
    process.env.SUPER_ADMIN_EMAIL ||
    "admin@example.com"
  }`;

  // Keys in server/.env (the old way) still work
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      subject,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    return process.env.VAPID_PUBLIC_KEY;
  }

  // Keys made earlier by this server
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "push"));
  if (row?.value?.publicKey) {
    try {
      const privateKey = unseal(row.value.privateKey);
      webpush.setVapidDetails(subject, row.value.publicKey, privateKey);
      return row.value.publicKey;
    } catch {
      // Made on another server (a restored backup): make new ones below
    }
  }

  // None yet: make a pair. Browsers signed up with an older pair can't
  // be reached with the new one, so they're forgotten; each signs up
  // again by itself the next time Uplink is opened there.
  const keys = webpush.generateVAPIDKeys();
  const value = {
    publicKey: keys.publicKey,
    privateKey: seal(keys.privateKey),
  };
  await db
    .insert(settings)
    .values({ key: "push", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  await db.delete(pushSubscriptions);
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  console.log("Desktop/phone notifications are set up.");
  return keys.publicKey;
}

// ---------- Sending ----------

// What the front end gets for a notification
function publicNotification(n) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    ticketId: n.ticketId,
    read: Boolean(n.readAt),
    at: n.createdAt.getTime(),
  };
}

// Sends one push message to every browser this person turned
// notifications on in. Browsers that were switched off or uninstalled
// answer "gone", and are forgotten.
async function pushTo(userIds, rows) {
  if (!(await pushKeys())) return;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  await Promise.all(
    subs.map(async (sub) => {
      const row = rows.find((r) => r.userId === sub.userId);
      if (!row) return;
      const message = JSON.stringify({
        title: row.title,
        body: row.body,
        url:
          row.kind === "job"
            ? "/calendar"
            : row.ticketId
              ? `/tickets/${row.ticketId}`
              : "/",
        // Same ticket and kind: the newer one replaces the older pop-up
        tag: `${row.kind}-${row.ticketId ?? row.id}`,
      });
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message,
          { TTL: 24 * 60 * 60 }, // try for up to a day if the device is off
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint));
        } else {
          console.error("Push failed:", err.statusCode ?? "", err.message);
        }
      }
    }),
  );
}

// Gives a notification to these people. Anyone who isn't active staff
// (customers, people still invited, removed people) is skipped.
export async function notify(userIds, { kind, title, body = "", ticketId }) {
  const wanted = [...new Set(userIds.filter(Boolean))];
  if (wanted.length === 0) return;

  const allowed = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, wanted),
        eq(users.status, "active"),
        inArray(users.role, STAFF),
      ),
    );
  if (allowed.length === 0) return;

  const rows = await db
    .insert(notifications)
    .values(
      allowed.map((u) => ({
        userId: u.id,
        kind,
        title: title.slice(0, 200),
        body: body.slice(0, 300),
        ticketId: ticketId ?? null,
      })),
    )
    .returning();

  for (const row of rows) {
    sendToUser(row.userId, "notification", publicNotification(row));
  }
  await pushTo(
    rows.map((r) => r.userId),
    rows,
  );
}

// Runs a notification without holding up the request that caused it.
// If it fails, the ticket change still went through.
function inBackground(promise) {
  promise.catch((err) => console.error("Notification failed:", err));
}

// The Admins and the Super Admin, e.g. for new tickets
async function adminIds() {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ADMINS), eq(users.status, "active")));
  return rows.map((r) => r.id);
}

// Whoever has the ticket, or the Admins when nobody has it yet
async function ownersOf(ticket) {
  return ticket.assigneeId ? [ticket.assigneeId] : await adminIds();
}

const short = (text, max = 140) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

// ---------- The events (called from tickets.js) ----------

// A new ticket (an Admin made it) or request (from the customer portal)
export function onTicketCreated(ticket, customerName, actor) {
  inBackground(
    (async () => {
      const ids = (await adminIds()).filter((id) => id !== actor.id);
      await notify(ids, {
        kind: "newTicket",
        title:
          ticket.source === "portal"
            ? `New request #${ticket.id}`
            : `New ticket #${ticket.id}`,
        body: short(`${customerName}: ${ticket.subject}`),
        ticketId: ticket.id,
      });
    })(),
  );
}

// A ticket was assigned to you (by someone else, a rule, or yourself)
export function onTicketAssigned(ticket, assigneeId, actor) {
  if (!assigneeId) return;
  inBackground(
    notify([assigneeId], {
      kind: "assigned",
      title: `Ticket #${ticket.id} assigned to you`,
      body: short(
        assigneeId === actor.id
          ? `You took: ${ticket.subject}`
          : `${actor.name} gave you: ${ticket.subject}`,
      ),
      ticketId: ticket.id,
    }),
  );
}

// The customer wrote back
export function onCustomerReply(ticket, customerName, text) {
  inBackground(
    (async () => {
      await notify(await ownersOf(ticket), {
        kind: "customerReply",
        title: `${customerName} replied on #${ticket.id}`,
        body: short(text),
        ticketId: ticket.id,
      });
    })(),
  );
}

// ---------- Due soon and overdue ----------
// Checked every 5 minutes. Each ticket gets each warning once; changing
// its due date (tickets.js) makes it eligible again.

const DUE_SOON = HOUR; // "due soon" = within the next hour
// Tickets that went overdue long ago (e.g. old ones brought over from
// Freshdesk) are marked as done quietly instead of all pinging at once
const TOO_OLD = 24 * HOUR;

async function checkDueTimes() {
  const now = new Date();
  const open = notInArray(tickets.status, ["resolved", "closed"]);
  const pick = {
    id: tickets.id,
    subject: tickets.subject,
    dueBy: tickets.dueBy,
    assigneeId: tickets.assigneeId,
    customerName: customers.name,
  };

  // Due within the next hour
  const dueSoon = await db
    .select(pick)
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(
      and(
        open,
        isNull(tickets.dueSoonNotifiedAt),
        gt(tickets.dueBy, now),
        lte(tickets.dueBy, new Date(now.getTime() + DUE_SOON)),
      ),
    );
  for (const t of dueSoon) {
    await db
      .update(tickets)
      .set({ dueSoonNotifiedAt: now })
      .where(eq(tickets.id, t.id));
    const minutes = Math.max(1, Math.round((t.dueBy - now) / MINUTE));
    await notify(await ownersOf(t), {
      kind: "dueSoon",
      title: `#${t.id} is due in ${minutes} min`,
      body: short(`${t.customerName}: ${t.subject}`),
      ticketId: t.id,
    });
  }

  // Overdue
  const overdue = await db
    .select(pick)
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(
      and(open, isNull(tickets.overdueNotifiedAt), lte(tickets.dueBy, now)),
    );
  for (const t of overdue) {
    await db
      .update(tickets)
      .set({ overdueNotifiedAt: now, dueSoonNotifiedAt: now })
      .where(eq(tickets.id, t.id));
    if (now - t.dueBy > TOO_OLD) continue; // long overdue: no ping
    await notify(await ownersOf(t), {
      kind: "overdue",
      title: `#${t.id} is overdue`,
      body: short(`${t.customerName}: ${t.subject}`),
      ticketId: t.id,
    });
  }
}

export function startDueTimeChecks() {
  const run = () =>
    checkDueTimes().catch((err) => console.error("Due time check:", err));
  run();
  setInterval(run, 5 * MINUTE);
}

// ================================================================
// Routes: /api/notifications (the bell)
// ================================================================

export const notificationsRouter = Router();

// Your latest 50
notificationsRouter.get("/", requireRole(...STAFF), async (req, res) => {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, req.user.id))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(50);
  res.json(rows.map(publicNotification));
});

notificationsRouter.post(
  "/read-all",
  requireRole(...STAFF),
  async (req, res) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, req.user.id),
          isNull(notifications.readAt),
        ),
      );
    res.json({ ok: true });
  },
);

notificationsRouter.post(
  "/:id/read",
  requireRole(...STAFF),
  async (req, res) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, Number(req.params.id) || 0),
          eq(notifications.userId, req.user.id),
          isNull(notifications.readAt),
        ),
      );
    res.json({ ok: true });
  },
);

// ================================================================
// Routes: /api/push (turning desktop/phone notifications on and off)
// ================================================================

export const pushRouter = Router();

// The public half of the key pair: browsers need it to sign up
pushRouter.get("/key", requireRole(...STAFF), async (req, res) => {
  res.json({ publicKey: await pushKeys() });
});

// This browser said yes: remember where to send its notifications.
// If someone else used this browser before, it's now yours.
pushRouter.post("/subscribe", requireRole(...STAFF), async (req, res) => {
  const endpoint = String(req.body?.endpoint ?? "");
  const p256dh = String(req.body?.keys?.p256dh ?? "");
  const auth = String(req.body?.keys?.auth ?? "");
  if (
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 1000 ||
    !p256dh ||
    !auth ||
    p256dh.length > 200 ||
    auth.length > 100
  ) {
    throw new BadInput("That notification sign-up isn't valid.");
  }
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, userId: req.user.id, p256dh, auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: req.user.id, p256dh, auth },
    });
  res.json({ ok: true });
});

// Turn them off for this browser
pushRouter.post("/unsubscribe", requireRole(...STAFF), async (req, res) => {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, String(req.body?.endpoint ?? "")),
        eq(pushSubscriptions.userId, req.user.id),
      ),
    );
  res.json({ ok: true });
});
