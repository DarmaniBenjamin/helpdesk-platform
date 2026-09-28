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
  jsonb,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

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
    // Kept the same as Freshdesk's ticket numbers when importing
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
    // newTicket, assigned, customerReply, dueSoon or overdue
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

// ---------- Settings, sign-in sessions and invites ----------

// App settings, one row per section, e.g. "backup" or "freshdesk"
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
