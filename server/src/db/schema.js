// The database tables. Each "pgTable" below becomes one table in
// PostgreSQL. They match what the front end already uses, so the pages
// can switch from fake data to the real database one at a time.
//
// After changing anything in this file:
//   npm run db:generate   (writes the change as a migration file)
//   npm run db:migrate    (applies it to the database)
import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  smallint,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// A date and time, stored with its time zone
const time = (name) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => time("created_at").notNull().defaultNow();

// ---------- Fixed lists ----------

// Access levels (see src/Components/teamRoles.js in the front end)
export const roleEnum = pgEnum("role", ["owner", "admin", "agent", "customer"]);
export const memberStatusEnum = pgEnum("member_status", ["invited", "active"]);
export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "pending",
  "waiting",
  "resolved",
  "closed",
]);
// customer = from the customer, agent = reply to the customer,
// note = internal note, event = a history line ("changed status to ...")
export const messageKindEnum = pgEnum("message_kind", [
  "customer",
  "agent",
  "note",
  "event",
]);

// ---------- Departments ----------

export const departments = pgTable("departments", {
  id: text("id").primaryKey(), // e.g. "managed", or made up when created
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

// ---------- Customers ----------

// Freshdesk contact IDs are bigger than a normal "integer" can hold
// (e.g. 73007855456), so customer IDs are "bigint". mode: "number" gives
// them to the code as normal numbers.
const customerId = (name) => bigint(name, { mode: "number" });

export const customers = pgTable("customers", {
  // Kept the same as Freshdesk's contact IDs when importing
  id: customerId("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  // Empty (null) is allowed: some Freshdesk contacts only have a phone
  // number. Add an email on the customer's page later.
  email: text("email").unique(),
  phone: text("phone").notNull().default(""),
  company: text("company"), // empty = an individual
  extraEmails: text("extra_emails").array().notNull().default([]),
  extraPhones: text("extra_phones").array().notNull().default([]),
  // Where they are, for site visits: saved on the spot by an agent's phone
  // ("I'm here"), or typed in / pasted from a maps link. Opens in the
  // phone's maps app (see src/location.js).
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  locationNote: text("location_note").notNull().default(""), // e.g. "blue gate, upstairs"
  locationBy: text("location_by").notNull().default(""), // who saved it
  locationAt: time("location_at"),
  createdAt: createdAt(),
});

// ---------- People who can sign in ----------
// Staff (owner/admin/agent) and customers with portal access

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().default(""),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().default(""),
  photo: text("photo"), // small image, as a data URL for now
  title: text("title").notNull().default(""), // job title, typed freely
  role: roleEnum("role").notNull().default("agent"),
  status: memberStatusEnum("status").notNull().default("invited"),
  // Never the password itself: a scrambled version that can only be checked
  passwordHash: text("password_hash"),
  // Maintenance access: the developer who looks after the helpdesk. Set
  // and removed by the Super Admin; listed in its own section on the Team
  // page (seen by Admins and the Super Admin), and never given tickets.
  // (Can be empty, so backups from before this existed still restore.)
  maintenance: boolean("maintenance").default(false),
  // For customers: which customer record they are
  customerId: customerId("customer_id").references(() => customers.id, {
    onDelete: "cascade",
  }),
  invitedAt: time("invited_at"),
  joinedAt: time("joined_at"),
  lastActiveAt: time("last_active_at"),
  createdAt: createdAt(),
});

// Which departments each person is in (a person can be in several)
export const userDepartments = pgTable(
  "user_departments",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

// ---------- Tickets ----------

export const tickets = pgTable(
  "tickets",
  {
    // Kept the same as Freshdesk's ticket numbers when importing. A new
    // ticket gets the highest number + 1 (next_ticket_id(), migration
    // 0015), so after an import new tickets carry on after the last one.
    id: integer("id")
      .primaryKey()
      .default(sql`next_ticket_id()`),
    subject: text("subject").notNull(),
    description: text("description").notNull().default(""),
    status: ticketStatusEnum("status").notNull().default("open"),
    priority: smallint("priority").notNull().default(2), // 1 low ... 4 urgent
    // No department yet = a new request that hasn't been sorted
    departmentId: text("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    customerId: customerId("customer_id")
      .notNull()
      .references(() => customers.id),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("agent"), // email, portal, phone, agent
    // Labels like "printer" or "vip", e.g. brought over from Freshdesk
    tags: text("tags").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    firstResponseDue: time("first_response_due"),
    dueBy: time("due_by"),
    firstRespondedAt: time("first_responded_at"),
    resolvedAt: time("resolved_at"),
    closedAt: time("closed_at"),
    // The customer's star rating, once it's finished
    feedbackRating: smallint("feedback_rating"),
    feedbackComment: text("feedback_comment"),
    feedbackAt: time("feedback_at"),
    // When the "How did we do?" email went out (notices.js), so it's only
    // sent once per ticket
    feedbackRequestedAt: time("feedback_requested_at"),
    // Ticket Review: which Admin checked it, and when
    reviewedById: text("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: time("reviewed_at"),
    // When the "due soon" and "overdue" notifications went out, so each
    // is only sent once. Cleared when the due date changes.
    dueSoonNotifiedAt: time("due_soon_notified_at"),
    overdueNotifiedAt: time("overdue_notified_at"),
  },
  (t) => [
    index("tickets_status_idx").on(t.status),
    index("tickets_customer_idx").on(t.customerId),
    index("tickets_assignee_idx").on(t.assigneeId),
  ],
);

// The conversation and history on each ticket
export const messages = pgTable(
  "messages",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    kind: messageKindEnum("kind").notNull(),
    // Who wrote it. The name is kept too, so old messages still show
    // who wrote them even if that person leaves.
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    // For history lines: what kind of change it was, e.g. "assigned" or
    // "status:closed" (see activity.js for which show in the ticket)
    eventType: text("event_type"),
    // For replies and notes: how it reached the customer. Replies:
    // "email" or "whatsapp". Notes: "call", "whatsapp", "onsite" or
    // "other" (what the agent did, e.g. "Called, fixed it"). Empty for
    // older ones and customers' own messages.
    channel: text("channel"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_ticket_idx").on(t.ticketId)],
);

// Files added to a ticket's conversation: photos, PDFs, zips and so on.
// The file itself is kept in the uploads folder (see attachments.js);
// this is the record of it. A file is uploaded first (no message yet),
// then joined to the reply, note or request it was sent with.
export const attachments = pgTable(
  "attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Empty until it's sent with a message
    ticketId: integer("ticket_id").references(() => tickets.id, {
      onDelete: "cascade",
    }),
    messageId: integer("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fileName: text("file_name").notNull(), // the name it had, e.g. "invoice.pdf"
    size: integer("size").notNull(), // in bytes
    // The name it's stored under in the uploads folder (random, so two
    // files called "photo.jpg" never clash)
    storageKey: text("storage_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    index("attachments_ticket_idx").on(t.ticketId),
  ],
);

// ---------- Calendar: scheduled jobs ----------

// A piece of work booked for a time: a site visit, a remote session or a
// call, usually for a ticket (but not always, e.g. a monthly server
// check). One or more agents do it (jobAgents). See jobs.js.
export const jobs = pgTable(
  "jobs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("onsite"), // onsite, remote or call
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    location: text("location").notNull().default(""),
    notes: text("notes").notNull().default(""),
    ticketId: integer("ticket_id").references(() => tickets.id, {
      onDelete: "set null",
    }),
    customerId: customerId("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    // Done: ticked off once the work is finished
    doneAt: time("done_at"),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // When the "starts in 30 minutes" reminder went out (cleared when the
    // time changes, so it goes out again for the new time)
    remindedAt: time("reminded_at"),
    createdAt: createdAt(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_starts_idx").on(t.startsAt),
    index("jobs_ticket_idx").on(t.ticketId),
  ],
);

// Who does each job
export const jobAgents = pgTable(
  "job_agents",
  {
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // When the job's time comes: the alert keeps going off (a few times)
    // until this agent answers it on their phone ("I'm here" / dismiss)
    ackAt: time("ack_at"),
    alerts: integer("alerts").notNull().default(0),
    lastAlertAt: time("last_alert_at"),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.userId] }),
    index("job_agents_user_idx").on(t.userId),
  ],
);

// ---------- Knowledge Base ----------

export const answers = pgTable("answers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  problem: text("problem").notNull().default(""),
  solution: text("solution").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  departmentId: text("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  ticketId: integer("ticket_id").references(() => tickets.id, {
    onDelete: "set null",
  }),
  authorName: text("author_name").notNull().default(""),
  source: text("source").notNull().default("manual"), // manual or note
  uses: integer("uses").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

// ---------- Assignment rules and automations ----------

export const rules = pgTable("rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  keywords: text("keywords").array().notNull().default([]),
  departmentId: text("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  agentId: text("agent_id").references(() => users.id, {
    onDelete: "set null",
  }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

export const automations = pgTable("automations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // e.g. { "type": "resolvedFor", "value": 7 }
  trigger: jsonb("trigger").notNull(),
  // e.g. [{ "type": "setStatus", "value": "closed" }]
  actions: jsonb("actions").notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  runs: integer("runs").notNull().default(0),
  createdAt: createdAt(),
});

// Which time-based automations have already run on which ticket, so
// each runs once per situation. "anchor" is when the waiting started,
// e.g. the time of the customer's last message.
export const automationRuns = pgTable(
  "automation_runs",
  {
    automationId: integer("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    anchor: text("anchor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.automationId, t.ticketId, t.anchor] })],
);

// ---------- Notifications ----------

// Each notification someone gets (shown in the bell). Also sent as a
// desktop/phone notification to every browser they turned them on in.
export const notifications = pgTable(
  "notifications",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // newTicket, assigned, customerReply, dueSoon, overdue, automation,
    // alert (alerts.js) or activity (a change on your ticket, activity.js)
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    ticketId: integer("ticket_id").references(() => tickets.id, {
      onDelete: "cascade",
    }),
    readAt: time("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// Browsers that said yes to notifications. Each one gets its own address
// ("endpoint") from the browser maker (Google, Mozilla, Apple, Microsoft)
// that the server sends push messages to.
export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  p256dh: text("p256dh").notNull(), // the browser's key, to encrypt messages
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

// ---------- Email (Integrations → Email) ----------

// A mailbox the helpdesk reads new emails from (they become tickets) and
// sends agents' replies with. Connected by signing in with Microsoft or
// Google, or with an email address and password (any other provider).
export const mailboxes = pgTable("mailboxes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  address: text("address").notNull().unique(),
  name: text("name").notNull().default(""), // the sender name on automatic replies
  provider: text("provider").notNull(), // microsoft, google or imap
  // Where its mail is read (IMAP) and sent from (SMTP)
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  username: text("username").notNull(),
  // The password, or for Microsoft/Google the sign-in's refresh token,
  // locked with this server's secret key (see secrets.js)
  secret: text("secret").notNull(),
  // New tickets from this mailbox go to this agent and/or team
  assigneeId: text("assignee_id").references(() => users.id, {
    onDelete: "set null",
  }),
  departmentId: text("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  enabled: boolean("enabled").notNull().default(true),
  // Who can open a new ticket by emailing it: "known" = only customers
  // already on file (anyone else waits in Email review), "anyone"
  newTicketsFrom: text("new_tickets_from").notNull().default("known"),
  // Where reading got to: emails after this one are new
  uidValidity: text("uid_validity"),
  lastUid: bigint("last_uid", { mode: "number" }).notNull().default(0),
  lastCheckedAt: time("last_checked_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

// Every email in or out of a ticket, by its Message-ID, so a customer's
// reply (which points back at an earlier email) lands on the right
// ticket, and the same email is never turned into a ticket twice
export const emailMessages = pgTable(
  "email_messages",
  {
    messageId: text("message_id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    mailboxId: integer("mailbox_id").references(() => mailboxes.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull(), // "in" or "out"
    address: text("address").notNull().default(""), // the customer's address
    createdAt: createdAt(),
  },
  (t) => [index("email_messages_ticket_idx").on(t.ticketId)],
);

// Emails that would have opened a new ticket but look like they shouldn't
// (a newsletter, an automatic notice, or someone who isn't a customer):
// they wait in Email review until someone makes them a ticket or ignores
// them. The email itself is kept as a file (rawFile, in the uploads
// folder's "held" folder) so it can still become a ticket with its
// attachments. Cleared after 30 days.
export const heldEmails = pgTable(
  "held_emails",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    mailboxId: integer("mailbox_id").references(() => mailboxes.id, {
      onDelete: "cascade",
    }),
    messageId: text("message_id").notNull().unique(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name").notNull().default(""),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    reason: text("reason").notNull(), // "unknown" (not a customer) or "bulk"
    rawFile: text("raw_file").notNull(),
    receivedAt: time("received_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("held_emails_received_idx").on(t.receivedAt)],
);

// ---------- Backup alerts (from the backup gateway) ----------
// The backup gateway sends its alerts here (malware found, a device
// offline, off-site copies failing...) and each one becomes a ticket
// (see backupAlerts.js).

// The gateway's clients (e.g. "Acme Dental"), and which customer here
// each one is. Linked on Integrations → Backup alerts. Until someone
// links it, a customer is made with the client's name (madeCustomer).
// client "" = the gateway itself (e.g. its disk is nearly full).
export const backupClients = pgTable(
  "backup_clients",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    gatewayId: text("gateway_id").notNull(),
    gatewayName: text("gateway_name").notNull().default(""),
    client: text("client").notNull(),
    customerId: customerId("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    madeCustomer: boolean("made_customer").notNull().default(false),
    firstSeenAt: createdAt(),
    lastSeenAt: time("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("backup_clients_gateway_client_idx").on(t.gatewayId, t.client),
  ],
);

// Each ticket made from backup alerts. While "open", more alerts about
// the same problem on the same device (the same "key") are added to it
// as notes instead of making new tickets; "back to normal" resolves it.
export const backupAlerts = pgTable(
  "backup_alerts",
  {
    ticketId: integer("ticket_id")
      .primaryKey()
      .references(() => tickets.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // gateway | device | kind of problem
    clientId: integer("client_id").references(() => backupClients.id, {
      onDelete: "set null",
    }),
    open: boolean("open").notNull().default(true),
    count: integer("count").notNull().default(1),
    openedAt: createdAt(),
    lastEventAt: time("last_event_at").notNull().defaultNow(),
  },
  (t) => [index("backup_alerts_key_idx").on(t.key, t.open)],
);

// Alerts already handled, so one sent twice (the gateway tries again if
// it didn't hear back) isn't added twice. Kept for 30 days.
export const backupEvents = pgTable(
  "backup_events",
  {
    gatewayId: text("gateway_id").notNull(),
    eventId: bigint("event_id", { mode: "number" }).notNull(),
    receivedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.gatewayId, t.eventId] })],
);

// ---------- Alerts ----------

// Alerts from other systems (the backup gateway: backupAlerts.js), on the
// Alerts page (alerts.js) instead of the Inbox. One row per problem: more
// alerts about the same problem on the same device (the same "key") while
// it's open are counted on it. "Back to normal" resolves it. Critical ones
// also make a ticket by themselves; others only with "Make a ticket".
export const alerts = pgTable(
  "alerts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    source: text("source").notNull(), // "backup"
    key: text("key").notNull(), // gateway | device | kind of problem
    kind: text("kind").notNull().default(""), // malware, offline, disk...
    title: text("title").notNull(),
    severity: text("severity").notNull(), // info, low, medium, high, critical
    status: text("status").notNull().default("open"), // open, acknowledged, resolved
    device: text("device"),
    customerId: customerId("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    clientId: integer("client_id").references(() => backupClients.id, {
      onDelete: "set null",
    }),
    // The ticket made from it (critical ones, or "Make a ticket")
    ticketId: integer("ticket_id").references(() => tickets.id, {
      onDelete: "set null",
    }),
    count: integer("count").notNull().default(1),
    // The latest alert, written out
    details: text("details").notNull().default(""),
    acknowledgedById: text("acknowledged_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: time("acknowledged_at"),
    resolvedById: text("resolved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: time("resolved_at"),
    firstSeenAt: createdAt(),
    lastSeenAt: time("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    index("alerts_key_idx").on(t.key, t.status),
    index("alerts_status_idx").on(t.status, t.lastSeenAt),
    index("alerts_customer_idx").on(t.customerId),
  ],
);

// What happened to each alert: fired, again, back to normal,
// acknowledged, resolved, reopened, ticket made
export const alertEvents = pgTable(
  "alert_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    alertId: integer("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull().default(""),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("alert_events_alert_idx").on(t.alertId, t.createdAt)],
);

// ---------- Settings, sign-in sessions and invites ----------

// App settings, one row per section, e.g. "backup" or "freshdesk"
// ---------- Phone (PBX) ----------

// Every call the phone system told the helpdesk about (phone.js): from
// its webhook, or a voicemail email. call_id (the phone system's own ID
// for the call, or the email's Message-ID) stops the same call being
// handled twice when it's sent again.
export const phoneCalls = pgTable(
  "phone_calls",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    callId: text("call_id"),
    event: text("event").notNull(), // voicemail, missed or answered
    direction: text("direction").notNull().default("in"), // in or out
    fromNumber: text("from_number").notNull().default(""),
    fromName: text("from_name").notNull().default(""),
    extension: text("extension").notNull().default(""),
    duration: integer("duration"), // seconds
    via: text("via").notNull().default("webhook"), // webhook or email
    // What the helpdesk did with it: "ticket", "added", "noted", "logged"
    result: text("result").notNull().default(""),
    agentId: text("agent_id").references(() => users.id, {
      onDelete: "set null",
    }),
    customerId: customerId("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    ticketId: integer("ticket_id").references(() => tickets.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("phone_calls_call_id_idx").on(t.callId),
    index("phone_calls_created_idx").on(t.createdAt),
  ],
);

// ---------- WhatsApp ----------

// A WhatsApp Business number connected to the helpdesk (whatsapp.js),
// usually an agent's: messages to it become tickets for that agent.
// "coexistence" = it stays on the WhatsApp Business app on the agent's
// phone too, and what they send from the app is copied onto the ticket.
export const whatsappNumbers = pgTable("whatsapp_numbers", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  phoneNumberId: text("phone_number_id").notNull().unique(), // Meta's ID for it
  wabaId: text("waba_id").notNull().default(""),
  displayNumber: text("display_number").notNull().default(""),
  name: text("name").notNull().default(""), // the business name on WhatsApp
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  departmentId: text("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  token: text("token").notNull(), // locked with secrets.js
  coexistence: boolean("coexistence").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  lastMessageAt: time("last_message_at"),
  createdAt: createdAt(),
});

// Every WhatsApp message in or out of a ticket, by WhatsApp's own ID, so
// the same message is never added twice, and the next message from that
// person lands on the same ticket
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    wamid: text("wamid").primaryKey(),
    numberId: integer("number_id")
      .notNull()
      .references(() => whatsappNumbers.id, { onDelete: "cascade" }),
    waId: text("wa_id").notNull(), // the customer's WhatsApp number
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // in or out
    createdAt: createdAt(),
  },
  (t) => [
    index("whatsapp_messages_thread_idx").on(t.numberId, t.waId, t.createdAt),
  ],
);

// ---------- Maintenance: incidents ----------

// An application error (or a bug someone reported), recorded by
// incidents.js. Repeats of the same error are counted on one incident
// (same fingerprint). status follows the maintenance lifecycle:
// detected, investigating, fix_proposed, testing, awaiting_approval,
// approved, deployed, verified, and failed, rejected, rolled_back,
// dismissed. Everything stored here has had secrets and personal details
// taken out (incidentRules.js).
export const incidents = pgTable(
  "incidents",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    fingerprint: text("fingerprint").notNull().unique(),
    status: text("status").notNull().default("detected"),
    severity: text("severity").notNull().default("medium"),
    // server, crash, browser, user, health or spike
    source: text("source").notNull(),
    component: text("component").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull().default(""),
    stack: text("stack").notNull().default(""),
    description: text("description").notNull().default(""), // a person's bug report
    context: jsonb("context").notNull().default({}),
    count: integer("count").notNull().default(1),
    // Worth an AI investigation (incidentRules.js triage())
    investigate: boolean("investigate").notNull().default(false),
    lastRequestId: text("last_request_id"),
    reportedById: text("reported_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Filled in by the later stages: the AI's findings, and the GitHub
    // issue / pull request
    investigation: jsonb("investigation").notNull().default({}),
    github: jsonb("github").notNull().default({}),
    firstSeen: time("first_seen").notNull().defaultNow(),
    lastSeen: time("last_seen").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("incidents_last_seen_idx").on(t.lastSeen),
    index("incidents_status_idx").on(t.status),
  ],
);

// Everything that happened to an incident, and who did it: the audit
// history (detected, happened again, dismissed, investigated, approved,
// deployed...)
export const incidentEvents = pgTable(
  "incident_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull().default(""),
    body: text("body").notNull().default(""),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("incident_events_incident_idx").on(t.incidentId, t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// Who is signed in. The browser keeps a random token; only a scrambled
// version of it is stored here.
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(),
  createdAt: createdAt(),
});

// Links sent in invite and password-reset emails
export const tokens = pgTable("tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // "invite" or "reset"
  expiresAt: time("expires_at").notNull(),
  createdAt: createdAt(),
});
