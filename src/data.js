// ============================================================
// All the app's ticket data lives here, in one place.
// Every page reads from this file. When the backend is built,
// this file gets replaced by requests to the server, and the
// pages keep working the same way.
// ============================================================

export const HOUR = 60 * 60 * 1000; // one hour in milliseconds
export const DAY = 24 * HOUR;

// ---------- Settings ----------

// The five statuses, matching Freshdesk so the migration maps 1:1
export const STATUSES = {
  open: { label: "Open", badge: "bg-sky-50 text-sky-600 ring-sky-200" },
  pending: {
    label: "Pending",
    badge: "bg-violet-50 text-violet-600 ring-violet-200",
  },
  waiting: {
    label: "Waiting on Customer",
    badge: "bg-amber-50 text-amber-600 ring-amber-200",
  },
  resolved: {
    label: "Resolved",
    badge: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  },
  closed: {
    label: "Closed",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
  },
};

export const PRIORITIES = {
  1: { label: "Low" },
  2: { label: "Medium" },
  3: { label: "High" },
  4: { label: "Urgent" },
};

// How fast each priority must be answered / fixed, in hours
export const SLA_HOURS = {
  1: { firstResponse: 8, resolve: 72 },
  2: { firstResponse: 4, resolve: 24 },
  3: { firstResponse: 2, resolve: 8 },
  4: { firstResponse: 1, resolve: 4 },
};

export const DEPARTMENTS = [
  { id: "it", name: "IT Support" },
  { id: "net", name: "Networking" },
  { id: "m365", name: "Microsoft 365" },
  { id: "srv", name: "Server & Backups" },
  { id: "cctv", name: "CCTV & Security" },
  { id: "bill", name: "Billing" },
];

export const AGENTS = [
  { id: "a1", name: "Alex Charles", departments: ["it", "net", "srv"] },
  { id: "a2", name: "Kerry-Ann Joseph", departments: ["m365", "it"] },
  { id: "a3", name: "Marcus Pierre", departments: ["net", "cctv"] },
  { id: "a4", name: "Shanice Thomas", departments: ["bill", "it", "srv"] },
];

// ---------- Helpers ----------

export function isDone(ticket) {
  return ticket.status === "resolved" || ticket.status === "closed";
}

export function isOverdue(ticket) {
  return !isDone(ticket) && Date.now() > ticket.dueBy;
}

export function findDepartment(id) {
  return DEPARTMENTS.find((d) => d.id === id);
}

export function findAgent(id) {
  return AGENTS.find((a) => a.id === id);
}

// "30 min ago", "3 hours ago", "2 days ago"
export function timeAgo(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ---------- Fake tickets (until the backend exists) ----------

// A "seeded" random generator: gives the same random numbers every time,
// so the fake data doesn't change on every refresh.
let seed = 20260924;
function random() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
function pick(list) {
  return list[Math.floor(random() * list.length)];
}

const COMPANIES = [
  "Grand Anse Resort",
  "Spice Isle Traders",
  "Carenage Legal Chambers",
  "Belmont Pharmacy",
  "Lance aux Épines Villas",
  "Morne Rouge Dental",
  "Harbourview Accounting",
  "Westerhall Logistics",
];
const FIRST_NAMES = [
  "Kevin",
  "Renee",
  "Andre",
  "Tamika",
  "Jerome",
  "Nadia",
  "Curtis",
  "Alicia",
  "Devon",
  "Simone",
  "Troy",
  "Keisha",
  "Brandon",
  "Monique",
  "Rhea",
  "Jada",
];
const LAST_NAMES = [
  "Francis",
  "Noel",
  "Baptiste",
  "Alexander",
  "George",
  "Phillip",
  "Antoine",
  "Hosten",
  "Roberts",
  "Modeste",
  "Charles",
  "Mitchell",
];

const ISSUES = {
  it: [
    [
      "Outlook keeps asking for my password",
      "Since this morning Outlook pops up a password prompt every few minutes, even after I type it in correctly.",
    ],
    [
      "Laptop won't start after Windows update",
      "My laptop installed updates last night and now it's stuck on the spinning dots screen.",
    ],
    [
      "Printer on the second floor is offline",
      "Nobody upstairs can print. The printer shows ready but our computers say it's offline.",
    ],
    [
      "Set up a laptop for a new employee",
      "Someone starts Monday in accounts. They need a laptop with Office, email and the shared drive.",
    ],
    [
      "Front desk computer is very slow",
      "The reception PC takes about five minutes to open anything.",
    ],
  ],
  net: [
    [
      "Wi-Fi keeps dropping in the conference room",
      "The Wi-Fi disconnects every few minutes in the main conference room.",
    ],
    [
      "VPN to the branch office is down",
      "Staff at the branch can't reach the server at head office since about 8am.",
    ],
    [
      "Change the guest Wi-Fi password",
      "Please change the guest Wi-Fi password, we think it's been shared outside the building.",
    ],
    [
      "Access point in the east wing is offline",
      "The light on the access point outside room 12 is off and there's no signal in that corridor.",
    ],
  ],
  m365: [
    [
      "Create a mailbox for a new staff member",
      "Please set up an email account for our new front office assistant.",
    ],
    [
      "Give me access to the reservations mailbox",
      "I need to send from the reservations@ shared mailbox while my colleague is on leave.",
    ],
    [
      "Reset my authenticator app",
      "I got a new phone and can't approve sign-ins anymore.",
    ],
    [
      "OneDrive stopped syncing",
      "OneDrive has a red X on it and my files aren't updating.",
    ],
  ],
  srv: [
    [
      "Backup failed last night",
      "We got an alert email saying last night's backup job failed.",
    ],
    [
      "Server is running out of space",
      "Getting a warning that the D: drive on the server is 95% full.",
    ],
    [
      "Restore a folder from last week",
      "Someone deleted the contracts folder. Can we get it back from Friday's backup?",
    ],
  ],
  cctv: [
    [
      "Camera 4 shows no picture",
      "Camera 4 over the car park has been black since yesterday afternoon.",
    ],
    [
      "Recorder says storage is full",
      "The NVR screen shows a disk full warning.",
    ],
    [
      "Need footage from Saturday night",
      "We had an incident at the gate around 11pm Saturday. Can you export the footage?",
    ],
  ],
  bill: [
    [
      "Question about this month's invoice",
      "There's a line on the invoice for 'onsite visit' that I don't recognise.",
    ],
    [
      "Update our billing contact",
      "Please send invoices to our new accounts manager going forward.",
    ],
    [
      "Quote for a new server",
      "Our server is five years old. Can you send a quote for a replacement?",
    ],
  ],
};

function makeTickets() {
  const now = Date.now();
  const list = [];

  for (let i = 0; i < 170; i++) {
    const ageDays = Math.pow(random(), 1.5) * 90; // more recent tickets than old ones
    const createdAt = now - ageDays * DAY;
    const department = pick(DEPARTMENTS);
    const [subject, description] = pick(ISSUES[department.id]);
    const r = random();
    const priority = r < 0.28 ? 1 : r < 0.68 ? 2 : r < 0.92 ? 3 : 4;
    const company = pick(COMPANIES);
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const agents = AGENTS.filter((a) => a.departments.includes(department.id));
    let assignee = pick(agents).id;

    // Older tickets are mostly finished; newer ones are still being worked on
    let status;
    if (ageDays < 0.25) {
      status = random() < 0.75 ? "open" : "pending";
      if (random() < 0.4) assignee = null;
    } else if (ageDays < 4) {
      status = pick([
        "open",
        "open",
        "pending",
        "waiting",
        "waiting",
        "resolved",
        "resolved",
      ]);
    } else {
      status =
        random() < 0.04
          ? pick(["open", "waiting"])
          : random() < 0.72
            ? "closed"
            : "resolved";
    }

    const sla = SLA_HOURS[priority];
    const ticket = {
      subject,
      description,
      status,
      priority,
      department: department.id,
      company,
      requester: {
        name: `${first} ${last}`,
        email:
          `${first}.${last}@${company.toLowerCase().replace(/[^a-z]/g, "")}.gd`.toLowerCase(),
      },
      assignee,
      source: pick(["email", "email", "portal", "portal", "phone"]),
      createdAt,
      firstResponseDue: createdAt + sla.firstResponse * HOUR,
      dueBy: createdAt + sla.resolve * HOUR,
      firstRespondedAt: null,
      resolvedAt: null,
      closedAt: null,
    };

    const brandNew = status === "open" && ageDays < 0.08;
    if (!brandNew) {
      ticket.firstRespondedAt = Math.min(
        createdAt + sla.firstResponse * HOUR * (0.15 + random() * 0.9),
        now - 60000,
      );
    }
    if (status === "resolved" || status === "closed") {
      const hoursToFix = Math.min(
        ageDays * 24 * 0.9,
        sla.resolve * (0.15 + random() * 1.25),
      );
      ticket.resolvedAt = Math.max(
        createdAt + hoursToFix * HOUR,
        ticket.firstRespondedAt,
      );
      if (status === "closed")
        ticket.closedAt = Math.min(ticket.resolvedAt + 2 * DAY, now - HOUR);
    }

    // The conversation on the ticket
    const agentName = (findAgent(assignee) || AGENTS[0]).name;
    const messages = [
      {
        kind: "customer",
        author: ticket.requester.name,
        body: description,
        at: createdAt,
      },
    ];
    if (ticket.firstRespondedAt) {
      messages.push({
        kind: "agent",
        author: agentName,
        body: `Hi ${first}, thanks for letting us know. I'm looking into this now and will update you shortly.`,
        at: ticket.firstRespondedAt,
      });
    }
    if (status === "waiting") {
      messages.push({
        kind: "agent",
        author: agentName,
        body: `Hi ${first}, could you send a screenshot of the error and a good time for us to connect remotely?`,
        at: Math.min(ticket.firstRespondedAt + 2 * HOUR, now - 60000),
      });
    }
    if (ticket.resolvedAt) {
      messages.push({
        kind: "agent",
        author: agentName,
        body: "This should be sorted now. Reply to this ticket if anything is still off and it will reopen.",
        at: ticket.resolvedAt,
      });
    }
    ticket.messages = messages.map((m, index) => ({ ...m, id: index + 1 }));
    ticket.updatedAt = Math.max(
      ...messages.map((m) => m.at),
      ticket.closedAt || 0,
    );

    list.push(ticket);
  }

  // Oldest ticket gets the smallest number, like a real database
  list.sort((a, b) => a.createdAt - b.createdAt);
  list.forEach((ticket, index) => (ticket.id = 4650 + index));

  // Newest first
  return list.reverse();
}

export const tickets = makeTickets();
