// Everything for turning a Freshdesk JSON export into this app's tickets
// and customers. No screens in here, just the rules, so the Settings page
// stays readable.
import { HOUR, SLA_HOURS, isDone } from "../data";

// ---------- The fields you can bring over ----------
// key: the field in this app. guesses: the names Freshdesk (or a script)
// usually gives it, tried in order. required: can't be switched off.

export const CONTACT_FIELDS = [
  {
    key: "id",
    label: "Contact ID",
    hint: "Kept, so tickets can find their customer",
    guesses: ["id", "contact_id"],
    required: true,
  },
  {
    key: "name",
    label: "Name",
    guesses: ["name", "full_name"],
    required: true,
  },
  {
    key: "email",
    label: "Email",
    hint: "Contacts without one still come over. Add it on their page later.",
    guesses: ["email", "primary_email"],
  },
  {
    key: "phone",
    label: "Phone",
    hint: "If empty, their mobile becomes the main number",
    guesses: ["phone", "work_phone"],
  },
  {
    key: "mobile",
    label: "Mobile",
    hint: "Added to their phone numbers",
    guesses: ["mobile", "mobile_phone"],
  },
  {
    key: "otherPhones",
    label: "Other phone numbers",
    hint: "Added to their phone numbers",
    guesses: ["other_phone_numbers", "extra_phones", "extraPhones"],
  },
  {
    key: "company",
    label: "Business",
    hint: "A company name, or a company ID from the companies list",
    guesses: ["company_name", "company", "company_id"],
  },
  {
    key: "extraEmails",
    label: "Extra emails",
    guesses: ["other_emails", "extra_emails"],
  },
  {
    key: "createdAt",
    label: "Customer since",
    guesses: ["created_at", "createdAt"],
  },
];

export const TICKET_FIELDS = [
  {
    key: "id",
    label: "Ticket number",
    hint: "Kept the same, e.g. #4821",
    guesses: ["id", "display_id", "ticket_id"],
    required: true,
  },
  {
    key: "subject",
    label: "Subject",
    guesses: ["subject", "title"],
    required: true,
  },
  {
    key: "requester",
    label: "Customer",
    hint: "The contact ID, email, or requester details",
    guesses: ["requester_id", "requester", "email", "customer_id"],
    required: true,
  },
  {
    key: "description",
    label: "Description",
    guesses: ["description_text", "description", "body_text"],
  },
  { key: "status", label: "Status", guesses: ["status"] },
  { key: "priority", label: "Priority", guesses: ["priority"] },
  {
    key: "assignee",
    label: "Assigned to",
    hint: "Matched to your team by email. No match = unassigned.",
    guesses: ["responder_id", "assignee", "responder"],
  },
  {
    key: "source",
    label: "Source",
    hint: "How it came in: email, portal or phone",
    guesses: ["source"],
  },
  {
    key: "tags",
    label: "Tags",
    hint: 'Labels like "printer" or "vip"',
    guesses: ["tags"],
  },
  {
    key: "createdAt",
    label: "Created date",
    guesses: ["created_at", "createdAt"],
  },
  { key: "dueBy", label: "Due date", guesses: ["due_by", "dueBy"] },
  {
    key: "updatedAt",
    label: "Last updated",
    guesses: ["updated_at", "updatedAt"],
  },
  {
    key: "messages",
    label: "Notes and replies",
    hint: "The conversation: replies, customer messages and private notes",
    guesses: ["conversations", "notes", "messages"],
  },
];

// Freshdesk's status numbers -> this app's statuses
export const FRESHDESK_STATUSES = {
  2: "open",
  3: "pending",
  4: "resolved",
  5: "closed",
  6: "waiting",
  7: "waiting",
};

// Freshdesk's source numbers -> how a ticket came in here (email, portal,
// phone or agent). Chat and the feedback widget are closest to the portal;
// an outbound email was started by one of the team.
export const FRESHDESK_SOURCES = {
  1: "email",
  2: "portal",
  3: "phone",
  7: "portal",
  9: "portal",
  10: "agent",
};

// ---------- Reading the file ----------

// Finds the tickets, contacts, companies and agents in whatever was
// uploaded. Works with { tickets: [...], contacts: [...] }, or a plain
// list of either.
export function readExport(json) {
  const found = { tickets: [], contacts: [], companies: [], agents: [] };
  const lists = Array.isArray(json)
    ? [json]
    : Object.entries(json ?? {}).map(([name, value]) => {
        // Named lists go straight to the right place
        const key = name.toLowerCase();
        if (Array.isArray(value) && key.includes("compan")) {
          found.companies.push(...value);
          return [];
        }
        if (Array.isArray(value) && key.includes("agent")) {
          found.agents.push(...value);
          return [];
        }
        if (Array.isArray(value) && key.includes("contact")) {
          found.contacts.push(...value);
          return [];
        }
        if (Array.isArray(value) && key.includes("ticket")) {
          found.tickets.push(...value);
          return [];
        }
        return Array.isArray(value) ? value : [];
      });

  // Unnamed lists: tickets have a subject, contacts have an email
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      if ("subject" in item) found.tickets.push(item);
      else if ("email" in item || "name" in item) found.contacts.push(item);
    }
  }
  return found;
}

// Every field name that appears in the records (checks the first 50)
export function sourceKeys(records) {
  const keys = new Set();
  for (const r of records.slice(0, 50))
    Object.keys(r).forEach((k) => keys.add(k));
  return [...keys].sort();
}

// Picks a starting mapping: every field switched on, pointing at the first
// guess that exists in the file
export function guessMapping(fields, keys) {
  const mapping = {};
  for (const field of fields) {
    const source = field.guesses.find((g) => keys.includes(g)) ?? "";
    mapping[field.key] = { on: field.required || Boolean(source), source };
  }
  return mapping;
}

// A short preview of a value, for the "Example" column
export function sampleText(value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return value.name ?? value.email ?? "{…}";
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

// ---------- Turning values into this app's format ----------

// Dates can be "2024-05-01T10:00:00Z", milliseconds or seconds
function toTime(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : time;
}

function toStatus(value) {
  if (typeof value === "number") return FRESHDESK_STATUSES[value] ?? "open";
  const text = String(value ?? "").toLowerCase();
  if (text.includes("wait")) return "waiting";
  if (["open", "pending", "resolved", "closed"].includes(text)) return text;
  return FRESHDESK_STATUSES[Number(text)] ?? "open";
}

function toPriority(value) {
  const words = { low: 1, medium: 2, high: 3, urgent: 4 };
  const n = words[String(value).toLowerCase()] ?? Number(value);
  return n >= 1 && n <= 4 ? Math.round(n) : 2;
}

function toSource(value) {
  if (typeof value === "number") return FRESHDESK_SOURCES[value] ?? "email";
  const text = String(value ?? "").toLowerCase();
  if (["email", "portal", "phone", "agent"].includes(text)) return text;
  if (text.includes("phone")) return "phone";
  if (text.includes("portal") || text.includes("chat")) return "portal";
  return FRESHDESK_SOURCES[Number(text)] ?? "email";
}

// Tags can be a list, or text like "printer, vip"
function toTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .filter(Boolean);
  return [
    ...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 20);
}

// A phone value: one number, or a list of them
function toPhones(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((p) => String(p ?? "").trim())
    .filter((p) => p && p !== "null");
}

// Reads one field from a record using the chosen mapping
function pick(record, mapping, key) {
  const m = mapping[key];
  if (!m?.on || !m.source) return undefined;
  return record[m.source];
}

// ---------- Contacts ----------

export function convertContacts(records, mapping, companies) {
  const companyNames = new Map(companies.map((c) => [String(c.id), c.name]));
  const now = Date.now();
  const result = [];
  const skipped = [];

  for (const r of records) {
    const id = Number(pick(r, mapping, "id"));
    const rawEmail = String(pick(r, mapping, "email") ?? "")
      .trim()
      .toLowerCase();
    // Something that looks like an email, or none at all
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;

    // Every number they have: main phone first, then mobile, then others.
    // No repeats. The first one is their main number.
    const phones = [
      ...new Set([
        ...toPhones(pick(r, mapping, "phone")),
        ...toPhones(pick(r, mapping, "mobile")),
        ...toPhones(pick(r, mapping, "otherPhones")),
      ]),
    ];

    // No name in Freshdesk: use their email or phone so they can be found
    const name =
      String(pick(r, mapping, "name") ?? "").trim() || email || phones[0] || "";

    if (!id) {
      skipped.push(`${name || "A contact"} (no contact ID)`);
      continue;
    }
    if (!name) {
      skipped.push(`Contact ${id} (no name, email or phone)`);
      continue;
    }

    // A number looks like a company ID: look it up. Text is the name itself.
    const rawCompany = pick(r, mapping, "company");
    const company =
      rawCompany === undefined || rawCompany === null || rawCompany === ""
        ? null
        : (companyNames.get(String(rawCompany)) ??
          (typeof rawCompany === "number" ? null : String(rawCompany)));

    const extra = pick(r, mapping, "extraEmails");
    result.push({
      id,
      name,
      email,
      phone: phones[0] ?? "",
      company,
      extraEmails: Array.isArray(extra)
        ? extra.map((e) => String(e).toLowerCase()).filter((e) => e !== email)
        : [],
      extraPhones: phones.slice(1),
      createdAt: toTime(pick(r, mapping, "createdAt"), now),
    });
  }
  return { contacts: result, skipped };
}

// ---------- Tickets ----------

// Works out who a ticket belongs to. `value` can be a contact ID, an email,
// or an object with id/name/email (Freshdesk's "requester").
function findCustomer(value, byId, byEmail) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    return (
      byId.get(Number(value.id)) ??
      (value.email && byEmail.get(String(value.email).toLowerCase())) ??
      null
    );
  }
  return (
    byId.get(Number(value)) ?? byEmail.get(String(value).toLowerCase()) ?? null
  );
}

// Works out who on your team a ticket goes to. `value` is Freshdesk's
// agent ID (responder_id), an email, or an object with an email.
// `freshdeskAgents`: ID -> { name, email } from Freshdesk.
// `staffByEmail`: email -> your team member.
// Returns { member } when matched, { name } when Freshdesk had someone
// who isn't on your team, or {} when it wasn't assigned.
function findAssignee(value, freshdeskAgents, staffByEmail) {
  if (value === undefined || value === null || value === "") return {};
  // Freshdesk's agent ID: look up who that is
  const agent =
    typeof value === "object"
      ? value
      : String(value).includes("@")
        ? { email: String(value) }
        : freshdeskAgents.get(Number(value));
  const email = agent?.email ?? "";
  const name = agent?.name ?? "";
  const member = staffByEmail.get(email.trim().toLowerCase());
  if (member) return { member };
  return { name: name || email || `Freshdesk agent ${value}` };
}

// Freshdesk conversations -> this app's messages
function convertMessages(list, customerName) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const kind = c.private ? "note" : c.incoming ? "customer" : "agent";
    return {
      kind,
      author:
        kind === "customer"
          ? customerName
          : (c.from_name ?? c.author ?? c.from_email ?? "Freshdesk agent"),
      body: String(c.body_text ?? c.body ?? c.text ?? "").trim(),
      at: toTime(c.created_at ?? c.at, Date.now()),
    };
  });
}

// `customers` must already include the contacts being imported.
// `aliases` (from mergeCustomers) points Freshdesk contact IDs at the
// customer they were matched to.
// `freshdeskAgents`: Freshdesk's agents ({ id, name, email }), and
// `team`: your team, so each ticket goes to the same person as in
// Freshdesk (matched by email). Only active staff can be given tickets.
// Returns the tickets, the ones skipped, and `unmatched`: Freshdesk
// agents who aren't on your team -> how many tickets they had.
export function convertTickets(
  records,
  mapping,
  customers,
  department,
  aliases = new Map(),
  freshdeskAgents = [],
  team = [],
) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  for (const [id, customer] of aliases) byId.set(id, customer);
  const byEmail = new Map();
  for (const c of customers) {
    if (c.email) byEmail.set(c.email, c);
    for (const e of c.extraEmails ?? []) byEmail.set(e, c);
  }

  const agentsById = new Map(
    freshdeskAgents.map((a) => [
      Number(a.id),
      {
        name: a.name ?? a.contact?.name ?? "",
        email: a.email ?? a.contact?.email ?? "",
      },
    ]),
  );
  const staffByEmail = new Map(
    team
      .filter((m) => m.role !== "customer" && m.status === "active")
      .map((m) => [String(m.email).toLowerCase(), m]),
  );
  const unmatched = new Map();

  const result = [];
  const skipped = [];
  const now = Date.now();

  for (const r of records) {
    const id = Number(pick(r, mapping, "id"));
    const subject = String(pick(r, mapping, "subject") ?? "").trim();
    // Freshdesk also includes a "requester" object when asked to; use it
    // if the chosen field doesn't find anyone
    const customer =
      findCustomer(pick(r, mapping, "requester"), byId, byEmail) ??
      findCustomer(r.requester, byId, byEmail);

    if (!id || !subject) {
      skipped.push(`${subject || "A ticket"} (missing number or subject)`);
      continue;
    }
    if (!customer) {
      skipped.push(
        `#${id} ${subject} (customer not found, import contacts too)`,
      );
      continue;
    }

    const createdAt = toTime(pick(r, mapping, "createdAt"), now);
    const status = mapping.status.on
      ? toStatus(pick(r, mapping, "status"))
      : "open";
    const priority = mapping.priority.on
      ? toPriority(pick(r, mapping, "priority"))
      : 2;
    const updatedAt = toTime(pick(r, mapping, "updatedAt"), createdAt);
    const description = String(pick(r, mapping, "description") ?? "").trim();

    // The first message is the customer's original request
    const conversation = convertMessages(
      pick(r, mapping, "messages"),
      customer.name,
    );
    const messages = [
      {
        kind: "customer",
        author: customer.name,
        body: description || subject,
        at: createdAt,
      },
      ...conversation,
    ].map((m, i) => ({ ...m, id: i + 1 }));

    const firstReply = conversation.find((m) => m.kind === "agent");

    // Who it goes to. Someone who isn't on your team: unassigned, and
    // counted so the page can tell you who to invite.
    const assigned = findAssignee(
      pick(r, mapping, "assignee"),
      agentsById,
      staffByEmail,
    );
    if (assigned.name)
      unmatched.set(assigned.name, (unmatched.get(assigned.name) ?? 0) + 1);

    const ticket = {
      id,
      subject,
      description,
      status,
      priority,
      department: department || null,
      customerId: customer.id,
      requester: customer,
      assignee: assigned.member?.id ?? null,
      source: mapping.source.on
        ? toSource(pick(r, mapping, "source"))
        : "email",
      tags: mapping.tags.on ? toTags(pick(r, mapping, "tags")) : [],
      createdAt,
      firstResponseDue: createdAt + SLA_HOURS[priority].firstResponse * HOUR,
      dueBy: toTime(
        pick(r, mapping, "dueBy"),
        createdAt + SLA_HOURS[priority].resolve * HOUR,
      ),
      firstRespondedAt: firstReply?.at ?? null,
      resolvedAt: null,
      closedAt: null,
      messages,
      updatedAt,
      feedback: null,
    };
    if (isDone(ticket)) {
      ticket.resolvedAt = updatedAt;
      if (status === "closed") ticket.closedAt = updatedAt;
    }
    result.push(ticket);
  }
  return { tickets: result, skipped, unmatched };
}

// ---------- A small example file, to test with ----------

export const EXAMPLE_EXPORT = {
  companies: [{ id: 501, name: "Spice Isle Traders" }],
  agents: [{ id: 7001, name: "Alex Charles", email: "alex@example.com" }],
  contacts: [
    {
      id: 90001,
      name: "Tricia Alexander",
      email: "tricia@spiceisle.example",
      phone: "+1 (473) 444-1010",
      company_id: 501,
      other_emails: ["accounts@spiceisle.example"],
      created_at: "2023-02-14T13:00:00Z",
    },
    {
      id: 90002,
      name: "Devon Charles",
      email: "devon.charles@example.com",
      mobile: "+1 (473) 533-2020",
      other_phone_numbers: ["+1 (473) 440-3030"],
      company_id: null,
      created_at: "2024-06-01T09:30:00Z",
    },
  ],
  tickets: [
    {
      id: 3120,
      subject: "Printer offline on the front desk PC",
      description_text:
        "The front desk printer shows offline since this morning.",
      requester_id: 90001,
      responder_id: 7001,
      source: 1,
      tags: ["printer"],
      status: 4,
      priority: 2,
      created_at: "2025-03-03T14:05:00Z",
      due_by: "2025-03-04T14:05:00Z",
      updated_at: "2025-03-03T16:40:00Z",
      conversations: [
        {
          body_text: "Restarted the print spooler remotely. Can you try again?",
          incoming: false,
          private: false,
          created_at: "2025-03-03T14:30:00Z",
        },
        {
          body_text:
            "Spooler service kept stopping. Set it to automatic restart.",
          incoming: false,
          private: true,
          created_at: "2025-03-03T14:32:00Z",
        },
        {
          body_text: "It's printing now, thank you!",
          incoming: true,
          private: false,
          created_at: "2025-03-03T16:35:00Z",
        },
      ],
    },
    {
      id: 3121,
      subject: "Can't connect to the office Wi-Fi",
      description_text: "My laptop can see the network but won't connect.",
      requester_id: 90002,
      source: 3,
      tags: [],
      status: 2,
      priority: 3,
      created_at: "2025-03-05T08:10:00Z",
      conversations: [],
    },
  ],
};

// ---------- Adding the results to what's already there ----------

// Contacts are matched to existing customers by ID or email.
// replace = true: update the existing customer. false: leave it alone.
// Returns the new customer list, the counts, and `aliases`: which existing
// customer each Freshdesk contact ID ended up as, so tickets can find them.
export function mergeCustomers(existing, incoming, replace) {
  const list = [...existing];
  // Quick lookups: ID -> position in the list, email -> position
  const byId = new Map();
  const byEmail = new Map();
  function remember(customer, index) {
    byId.set(customer.id, index);
    if (customer.email) byEmail.set(customer.email, index);
    for (const e of customer.extraEmails ?? []) byEmail.set(e, index);
  }
  list.forEach(remember);

  const aliases = new Map();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const contact of incoming) {
    // Same ID, or any of their emails already belongs to someone here
    let index = byId.get(contact.id);
    for (const e of [contact.email, ...contact.extraEmails]) {
      if (index === undefined && e) index = byEmail.get(e);
    }
    if (index === undefined) {
      index = list.length;
      list.push(contact);
      added += 1;
    } else if (replace) {
      // Keep the existing ID so their other tickets stay linked
      list[index] = { ...list[index], ...contact, id: list[index].id };
      updated += 1;
    } else {
      skipped += 1;
    }
    remember(list[index], index);
    aliases.set(contact.id, list[index]);
  }
  return { list, aliases, added, updated, skipped };
}

// Tickets are matched by ticket number
export function mergeTickets(existing, incoming, replace) {
  const byId = new Map(existing.map((t) => [t.id, t]));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const ticket of incoming) {
    if (!byId.has(ticket.id)) {
      byId.set(ticket.id, ticket);
      added += 1;
    } else if (replace) {
      byId.set(ticket.id, ticket);
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  // Newest first, like the rest of the app
  const list = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  return { list, added, updated, skipped };
}
