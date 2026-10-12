// Phone (PBX): Integrations → Phone. Works with any phone system, two ways
// (use either, or both):
//
//  1. Voicemail emails: nearly every phone system (3CX, FreePBX/Asterisk,
//     Yeastar, Grandstream, hosted ones...) can email each voicemail with
//     the recording attached. Send them to a mailbox connected in
//     Integrations → Email and put the phone system's sending address on
//     the list here: those emails become voicemail tickets instead of
//     email tickets (email.js hands them over).
//
//  2. The call webhook: phone systems that can call a web address when
//     something happens (3CX's CRM integration, Yeastar's API, a small
//     script on FreePBX: deploy/pbx/freepbx-voicemail.sh) send the call
//     here, by GET or POST (form, JSON, or a file upload):
//
//       /api/phone/hook/<token>?event=voicemail&from=4735551234&ext=204
//
//     Fields (any of the names in brackets, upper or lower case):
//       event      voicemail, missed or answered  [event type status calltype]
//       from       the caller's number            [from caller callerid number cid]
//       name       the caller's name              [name callername cidname]
//       ext        the extension that was called  [ext extension to agent mailbox]
//       duration   seconds, or 1:23               [duration seconds length]
//       id         the call's own ID, so a call sent twice is only handled once
//                  [id callid uniqueid]
//       direction  in or out                      [direction]
//       a file     the recording (any field name), or recording=<link>
//
// What happens to a call:
//   - voicemail: a ticket for the agent whose extension it was, for the
//     customer with that phone number (added if they're new), with the
//     recording attached to play on the ticket. Another voicemail from
//     them while that ticket is open (within 2 days) goes on the same
//     ticket.
//   - answered and recorded (the phone system sends the recording when
//     the call ends): the recording goes on the caller's newest unfinished
//     ticket as a note, or on a new ticket if they have none ("Recorded
//     calls go on tickets", on by default).
//   - missed (no voicemail): a ticket too, only if "Missed calls become
//     tickets" is on.
//   - answered, not recorded: if "Note answered calls" is on and the
//     caller is a customer with an unfinished ticket, a note goes on it
//     ("Call from Keisha, 3:05"). Otherwise it's only on the call list.
//   Nothing is written out from the recordings: the recording itself is
//   kept, so nothing anyone said is lost.
//
//   /api/phone/lookup/<token>?number=4735551234   who's calling? For a
//     screen pop: the phone system (e.g. 3CX's CRM template) shows the
//     customer's name, and links to them and their open ticket.
//
//   GET  /api/phone            the settings, agents, teams, recent calls (Admins)
//   PUT  /api/phone            save the settings
//   POST /api/phone/token      a new webhook token (the old address stops working)
import crypto from "node:crypto";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { and, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import { db } from "./db/index.js";
import { phoneCalls, settings, tickets, users } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS } from "./permissions.js";
import { MAX_FILE_SIZE } from "./attachments.js";
import { BadInput } from "./validate.js";
import { seal, unseal } from "./secrets.js";
import {
  activeStaff,
  addCustomerMessage,
  addNote,
  createInboundTicket,
  customerForPhone,
  digitsOf,
  endingForType,
  existingTeam,
  findCustomerByPhone,
  formatDuration,
  isAudio,
  prettyPhone,
  saveFile,
  staffByEmail,
  staffList,
  teamList,
  unknownCaller,
} from "./inbound.js";

export const phoneRouter = Router();

const SETTING = "phone";
const DAY = 24 * 60 * 60 * 1000;
const UNFINISHED = ["open", "pending", "waiting"];

const siteAddress = (req) => `${req.protocol}://${req.get("host")}`;

// ---------- Settings ----------

const DEFAULTS = {
  enabled: false,
  token: null, // locked with secrets.js
  departmentId: null,
  extensions: [], // [{ ext: "204", userId }]
  voicemailSenders: [], // email addresses (or @domain.com) voicemails come from
  missedCalls: false,
  recordedCalls: true,
  logCalls: true,
};

async function loadSettings() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SETTING));
  return { ...DEFAULTS, ...(row?.value ?? {}) };
}
async function saveSettings(value) {
  await db
    .insert(settings)
    .values({ key: SETTING, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

function tokenOf(config) {
  if (!config.token) return null;
  try {
    return unseal(config.token);
  } catch {
    return null; // locked with a key this server doesn't have any more
  }
}

function tokenMatches(config, given) {
  const token = tokenOf(config);
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(token ?? "");
  return Boolean(token) && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Who the call was for ----------

// The agent with this extension (Integrations → Phone), else the staff
// member the voicemail email was sent to
async function agentFor(config, ext, toEmails = []) {
  const wanted = String(ext ?? "").trim();
  if (wanted) {
    const row = config.extensions.find((e) => e.ext === wanted);
    const agent = await activeStaff(row?.userId);
    if (agent) return agent;
  }
  for (const address of toEmails) {
    const agent = await staffByEmail(address);
    if (agent) return agent;
  }
  return null;
}

// ---------- One call ----------

// What kind of call it was, from however the phone system says it. With
// no event at all: a recording on its own is a voicemail, a length means
// it was answered, nothing means it was missed.
function eventOf(value, { hasAudio, duration }) {
  const e = String(value ?? "").toLowerCase().trim();
  if (!e) return hasAudio ? "voicemail" : duration > 0 ? "answered" : "missed";
  if (/voice|vmail|^vm/.test(e)) return "voicemail";
  if (/notanswered|not.answered/.test(e)) return "unanswered"; // we called, they didn't pick up
  if (/miss|no.?answer|unanswer|abandon|busy/.test(e)) return "missed";
  if (
    /record|answer|complete|connect|inbound|outbound|incoming|outgoing|end|hang/.test(
      e,
    )
  )
    return "answered";
  return "other";
}

function directionOf(value, event) {
  const d = String(value ?? "").toLowerCase();
  if (/out/.test(d) || event === "unanswered") return "out";
  return "in";
}

// "83", "1:23" or "00:01:23" -> seconds
function secondsOf(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const parts = v.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

// The ticket a caller's earlier voicemail or missed call made, if it's
// still going and from the last 2 days: more calls from them go on it
async function recentPhoneTicket(customerId) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.customerId, customerId),
        eq(tickets.source, "phone"),
        inArray(tickets.status, UNFINISHED),
        gt(tickets.createdAt, new Date(Date.now() - 2 * DAY)),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(1);
  return ticket ?? null;
}

// The customer's newest unfinished ticket, for noting an answered call
async function latestOpenTicket(customerId) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.customerId, customerId),
        notInArray(tickets.status, ["resolved", "closed"]),
      ),
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(1);
  return ticket ?? null;
}

// One call at a time, so the same call sent twice at once can't make two
// tickets
let queue = Promise.resolve();
const oneAtATime = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

// Handles one call. call: { event, direction, number, name, ext,
// duration, callId, audio: { fileName, type, content } | null, via,
// toEmails }. Returns { result, ticketId }.
export function handleCall(call) {
  return oneAtATime(async () => {
    const config = await loadSettings();
    if (call.callId) {
      const [seen] = await db
        .select()
        .from(phoneCalls)
        .where(eq(phoneCalls.callId, call.callId));
      if (seen) return { result: "already had it", ticketId: seen.ticketId };
    }

    const agent = await agentFor(config, call.ext, call.toEmails);
    const number = digitsOf(call.number).length >= 3 ? call.number : "";
    const pretty = prettyPhone(number);
    const extText = call.ext ? ` (extension ${call.ext})` : "";
    const out = call.direction === "out";
    let result = "logged";
    let ticket = null;
    let customer = null;

    const voicemail = call.event === "voicemail";
    const missed =
      call.event === "missed" && !out && config.missedCalls;
    // An answered call that the phone system recorded: the recording goes
    // on the caller's ticket, so what was said is kept with it
    const recorded =
      call.event === "answered" && Boolean(call.audio) && config.recordedCalls;

    if (voicemail || missed || recorded) {
      customer = number
        ? await customerForPhone(number, call.name)
        : await unknownCaller();
      const who = call.name || pretty || "a hidden number";
      const length = call.duration ? ` (${formatDuration(call.duration)})` : "";
      const lines = [
        voicemail
          ? `Voicemail from ${who}${length}`
          : missed
            ? `Missed call from ${who}. They didn't leave a voicemail: call them back.`
            : out
              ? `Call to ${who}${length}`
              : `Call from ${who}${length}`,
      ];
      if (pretty && call.name) lines.push(`Number: ${pretty}`);
      if (agent || call.ext)
        lines.push(
          `${recorded ? "Answered by" : "For"}: ${agent?.name ?? "extension"}${extText}`,
        );
      if (call.audio) lines.push("The recording is attached: play it below.");
      else if (voicemail)
        lines.push("(The phone system didn't send the recording.)");
      const body = lines.join("\n");

      // Where it goes:
      //   a voicemail or missed call: the ticket an earlier one from them
      //   made (still going, from the last 2 days), else a new ticket
      //   a recorded call: their newest unfinished ticket, else a new one
      // Hidden numbers are never grouped: they could be anyone.
      const existing = !number
        ? null
        : recorded
          ? await latestOpenTicket(customer.id)
          : await recentPhoneTicket(customer.id);
      let messageId;
      if (existing && recorded) {
        ticket = existing;
        messageId = await addNote(existing, {
          authorName: agent?.name ?? "Phone system",
          body,
          channel: "call",
        });
        result = "noted";
      } else if (existing) {
        ticket = existing;
        messageId = await addCustomerMessage(existing, {
          authorName: customer.name,
          body,
          reopenedBody: "called again",
        });
        result = "added";
      } else {
        ({ ticket, messageId } = await createInboundTicket({
          customer,
          subject: voicemail
            ? `Voicemail from ${who}`
            : missed
              ? `Missed call from ${who}`
              : `Call with ${who}`,
          body,
          authorName: customer.name,
          source: "phone",
          assigneeId: agent?.id ?? null,
          departmentId: config.departmentId,
          tags: [
            "phone",
            voicemail ? "voicemail" : missed ? "missed-call" : "recorded-call",
          ],
          createdBody: voicemail
            ? `called${extText ? ` ${agent?.name ?? "extension"}${extText}` : ""} and left a voicemail`
            : missed
              ? "called and nobody answered"
              : out
                ? `was called${agent ? ` by ${agent.name}` : ""}`
                : `called${agent ? ` and spoke to ${agent.name}` : ""}`,
        }));
        result = "ticket";
      }

      if (call.audio) {
        const ending =
          path.extname(call.audio.fileName).slice(1).toLowerCase() ||
          endingForType(call.audio.type);
        const label = voicemail ? "voicemail" : "call";
        const saved = await saveFile({
          fileName: `${label}-${pretty.replace(/[^\d+]/g, "") || "caller"}-${new Date().toISOString().slice(0, 10)}.${ending}`,
          content: call.audio.content,
          ticketId: ticket.id,
          messageId,
        });
        if (!saved)
          await addNote(ticket, {
            authorName: "Phone system",
            body: `The recording couldn't be kept here: it's over 25 MB, or a kind of file that can't be attached (.${ending}). It's still on the phone system.`,
            channel: "call",
          });
      }
    } else if (call.event === "answered" && config.logCalls && number) {
      // Answered, but not recorded: a short note on their open ticket
      customer = await findCustomerByPhone(number);
      const open = customer ? await latestOpenTicket(customer.id) : null;
      if (open) {
        ticket = open;
        const length = call.duration ? `, ${formatDuration(call.duration)}` : "";
        await addNote(open, {
          authorName: agent?.name ?? "Phone system",
          body: out
            ? `Called ${customer.name} (${pretty})${length}`
            : `Call from ${customer.name} (${pretty})${length}${agent ? ` with ${agent.name}` : extText}`,
          channel: "call",
        });
        result = "noted";
      }
    }

    await db
      .insert(phoneCalls)
      .values({
        callId: call.callId || null,
        event: call.event,
        direction: call.direction,
        fromNumber: pretty,
        fromName: (call.name || "").slice(0, 100),
        extension: String(call.ext ?? "").slice(0, 20),
        duration: call.duration ?? null,
        via: call.via,
        result,
        agentId: agent?.id ?? null,
        customerId: customer?.id ?? null,
        ticketId: ticket?.id ?? null,
      })
      .onConflictDoNothing();
    return { result, ticketId: ticket?.id ?? null };
  });
}

// ---------- 1. Voicemail emails (from email.js) ----------

const onSenderList = (list, address) =>
  list.some((entry) => {
    const e = String(entry).toLowerCase();
    return e.startsWith("@") ? address.endsWith(e) : address === e;
  });

// Is this email from the phone system? (email.js asks, for every email)
export async function isVoicemailSender(address) {
  const config = await loadSettings();
  return (
    config.enabled &&
    onSenderList(config.voicemailSenders, String(address).toLowerCase())
  );
}

// Who called, which extension, and how long, out of a voicemail email.
// Phone systems word them differently, e.g.
//   Asterisk/FreePBX: "...left a 0:42 long message in mailbox 204 from
//                      "Keisha Charles" <4735551234>, on ..."
//   3CX:              "New voicemail from Keisha Charles (4735551234)"
//                     "Caller ID: 4735551234"
export function readVoicemailEmail(parsed) {
  const subject = String(parsed.subject ?? "");
  const text = String(parsed.text ?? "").replace(/\u00a0/g, " ");
  const all = `${subject}\n${text}`;
  const phone = String.raw`\+?\d[\d \t().-]{4,20}\d`;
  let name = "";
  let number = "";

  // "Name" <number>   or   Name <number>   or   Name (number)
  const named = all.match(
    new RegExp(String.raw`"?([A-Za-z][^"<>()\n]{0,60}?)"?\s*[<(]\s*(${phone})\s*[>)]`),
  );
  if (named) {
    // "New voicemail from Keisha Charles" -> "Keisha Charles"
    name = named[1]
      .replace(/^.*?\b(from|by)\b\s*:?\s*/i, "")
      .replace(/^caller(\s*id)?\s*:?\s*/i, "")
      .trim();
    number = named[2];
  }
  // Caller ID: number   /   From: number
  if (!number) {
    const labelled = all.match(
      new RegExp(
        String.raw`(?:caller\s*id|caller|calling\s*number|from|phone(?:\s*number)?|number)\s*[:#-]?\s*(${phone})`,
        "i",
      ),
    );
    if (labelled) number = labelled[1];
  }
  // Caller name: ...
  if (!name) {
    const labelledName = text.match(/caller\s*name\s*[:-]\s*([^\n]{1,60})/i);
    if (labelledName) name = labelledName[1].trim();
  }
  // Anything that looks like a phone number, as a last try (not a date)
  if (!number) {
    for (const m of all.matchAll(new RegExp(phone, "g"))) {
      const d = digitsOf(m[0]);
      if (d.length >= 7 && d.length <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(m[0])) {
        number = m[0];
        break;
      }
    }
  }
  if (/^(unknown|anonymous|private|restricted)$/i.test(name)) name = "";

  const ext = all.match(
    /(?:mailbox|extension|ext\.?|for)\s*[:#]?\s*(\d{2,6})\b/i,
  )?.[1];
  const length = all.match(
    /(?:duration|length)\s*[:=]?\s*(\d{1,2}:\d{2}(?::\d{2})?|\d+\s*s)|(\d{1,2}:\d{2}(?::\d{2})?)\s*long/i,
  );
  const duration = length
    ? secondsOf((length[1] || length[2]).replace(/\s*s$/, ""))
    : null;

  const recording = (parsed.attachments ?? []).find(
    (a) =>
      a.contentType?.startsWith("audio/") ||
      isAudio(a.filename ?? "") ||
      /\.(wav|mp3|gsm)$/i.test(a.filename ?? ""),
  );
  return {
    name: name.slice(0, 100),
    number,
    ext: ext ?? "",
    duration,
    audio: recording
      ? {
          fileName: recording.filename || `voicemail.${endingForType(recording.contentType)}`,
          type: recording.contentType,
          content: recording.content,
        }
      : null,
  };
}

// A voicemail email: a voicemail ticket. Returns the ticket's ID.
export async function voicemailFromEmail(parsed, messageId) {
  const vm = readVoicemailEmail(parsed);
  const toEmails = [
    ...(parsed.to?.value ?? []),
    ...(parsed.cc?.value ?? []),
  ].map((a) => a.address);
  const { ticketId } = await handleCall({
    event: "voicemail",
    direction: "in",
    number: vm.number,
    name: vm.name,
    ext: vm.ext,
    duration: vm.duration,
    callId: `email:${messageId}`,
    audio: vm.audio,
    via: "email",
    toEmails,
  });
  return ticketId;
}

// ---------- 2. The call webhook (the phone system calls this) ----------

// Any one of these names, in the query string or the form/JSON body,
// upper or lower case
function fieldFrom(req, names) {
  for (const source of [req.body, req.query]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (names.includes(key.toLowerCase().replace(/[\s_-]/g, "")))
        return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return "";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 50 },
});

// A recording given as a link instead of a file
async function download(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return null;
  const size = Number(res.headers.get("content-length") || 0);
  if (size > MAX_FILE_SIZE) return null;
  const content = Buffer.from(await res.arrayBuffer());
  if (content.length > MAX_FILE_SIZE) return null;
  return {
    fileName: path.basename(url.pathname) || "voicemail",
    type: res.headers.get("content-type"),
    content,
  };
}

async function hook(req, res) {
  const config = await loadSettings();
  if (!config.enabled || !tokenMatches(config, req.params.token))
    return res.status(404).json({ error: "Not found" });

  const file = req.files?.[0];
  let audio = file
    ? {
        fileName: file.originalname || "voicemail",
        type: file.mimetype,
        content: file.buffer,
      }
    : null;
  const link = fieldFrom(req, ["recording", "recordingurl", "url", "file"]);
  if (!audio && /^https?:\/\//i.test(link)) audio = await download(link).catch(() => null);

  const duration = secondsOf(fieldFrom(req, ["duration", "seconds", "length", "talktime"]));
  const rawEvent = fieldFrom(req, ["event", "type", "status", "calltype"]);
  const event = eventOf(rawEvent, { hasAudio: Boolean(audio), duration });
  const direction = directionOf(fieldFrom(req, ["direction", "calltype"]), event);
  const number = fieldFrom(req, [
    "from",
    "caller",
    "callerid",
    "callernumber",
    "number",
    "cid",
    "src",
  ]);
  // A hidden number may come with its name in the number field
  const name = fieldFrom(req, ["name", "callername", "cidname", "contactname"]);
  const ext = fieldFrom(req, [
    "ext",
    "extension",
    "to",
    "agent",
    "agentext",
    "mailbox",
    "dst",
  ]).replace(/[^\d]/g, "");
  const callId = fieldFrom(req, ["id", "callid", "uniqueid", "linkedid"]);

  if (event === "other" || event === "unanswered") {
    await db
      .insert(phoneCalls)
      .values({
        callId: callId ? `hook:${callId}` : null,
        event,
        direction,
        fromNumber: prettyPhone(number),
        fromName: name.slice(0, 100),
        extension: ext.slice(0, 20),
        duration,
        via: "webhook",
        result: "logged",
      })
      .onConflictDoNothing();
    return res.json({ ok: true, result: "logged" });
  }

  const done = await handleCall({
    event,
    direction,
    number,
    name: /^\+?[\d\s()-]+$/.test(name) ? "" : name,
    ext,
    duration,
    callId: callId ? `hook:${callId}` : null,
    audio,
    via: "webhook",
    toEmails: [],
  });
  res.json({ ok: true, ...done });
}

phoneRouter.get("/hook/:token", hook);
phoneRouter.post("/hook/:token", upload.any(), hook);

// Who's calling? For a screen pop in the phone system
phoneRouter.get("/lookup/:token", async (req, res) => {
  const config = await loadSettings();
  if (!config.enabled || !tokenMatches(config, req.params.token))
    return res.status(404).json({ error: "Not found" });
  const number = fieldFrom(req, ["number", "from", "phone", "callerid"]);
  const customer = await findCustomerByPhone(number);
  if (!customer) return res.json({ found: false, contacts: [] });
  const open = await latestOpenTicket(customer.id);
  const site = siteAddress(req);
  res.json({
    found: true,
    contacts: [
      {
        id: customer.id,
        name: customer.name,
        firstName: customer.name.split(" ")[0],
        lastName: customer.name.split(" ").slice(1).join(" "),
        company: customer.company ?? "",
        email: customer.email ?? "",
        phone: customer.phone,
        url: `${site}/customers/${customer.id}`,
        openTicket: open
          ? {
              id: open.id,
              subject: open.subject,
              url: `${site}/tickets/${open.id}`,
            }
          : null,
      },
    ],
  });
});

// ---------- Settings (Admins) ----------

phoneRouter.use(requireRole(...ADMINS));

async function view() {
  const config = await loadSettings();
  const recent = await db
    .select({ call: phoneCalls, agentName: users.name })
    .from(phoneCalls)
    .leftJoin(users, eq(phoneCalls.agentId, users.id))
    .orderBy(desc(phoneCalls.createdAt))
    .limit(20);
  return {
    enabled: config.enabled,
    token: tokenOf(config),
    departmentId: config.departmentId,
    extensions: config.extensions,
    voicemailSenders: config.voicemailSenders,
    missedCalls: config.missedCalls,
    logCalls: config.logCalls,
    recordedCalls: config.recordedCalls,
    agents: await staffList(),
    teams: await teamList(),
    calls: recent.map(({ call, agentName }) => ({
      id: call.id,
      event: call.event,
      direction: call.direction,
      number: call.fromNumber,
      name: call.fromName,
      extension: call.extension,
      duration: call.duration,
      via: call.via,
      result: call.result,
      agentName: agentName ?? null,
      ticketId: call.ticketId,
      at: call.createdAt.getTime(),
    })),
  };
}

phoneRouter.get("/", async (req, res) => {
  res.json(await view());
});

phoneRouter.put("/", async (req, res) => {
  const config = await loadSettings();
  const next = { ...config };
  const b = req.body ?? {};
  if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
  if (b.missedCalls !== undefined) next.missedCalls = Boolean(b.missedCalls);
  if (b.logCalls !== undefined) next.logCalls = Boolean(b.logCalls);
  if (b.recordedCalls !== undefined)
    next.recordedCalls = Boolean(b.recordedCalls);
  if (b.departmentId !== undefined) {
    next.departmentId = b.departmentId ? await existingTeam(b.departmentId) : null;
    if (b.departmentId && !next.departmentId)
      throw new BadInput("That team doesn't exist any more.");
  }
  if (b.extensions !== undefined) {
    if (!Array.isArray(b.extensions) || b.extensions.length > 500)
      throw new BadInput("That list of extensions isn't valid.");
    const seen = new Set();
    next.extensions = [];
    for (const row of b.extensions) {
      const ext = String(row?.ext ?? "").trim();
      if (!ext) continue;
      if (!/^\d{1,8}$/.test(ext))
        throw new BadInput(`"${ext}" isn't an extension: use its number, e.g. 204.`);
      if (seen.has(ext)) throw new BadInput(`Extension ${ext} is on the list twice.`);
      seen.add(ext);
      if (!(await activeStaff(row.userId)))
        throw new BadInput(`Pick who extension ${ext} belongs to.`);
      next.extensions.push({ ext, userId: String(row.userId) });
    }
  }
  if (b.voicemailSenders !== undefined) {
    if (!Array.isArray(b.voicemailSenders) || b.voicemailSenders.length > 50)
      throw new BadInput("That list of addresses isn't valid.");
    next.voicemailSenders = [
      ...new Set(
        b.voicemailSenders
          .map((a) => String(a).trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    for (const a of next.voicemailSenders)
      if (!/^([^\s@]+)?@[^\s@]+\.[^\s@]+$/.test(a))
        throw new BadInput(
          `"${a}" isn't an email address. Use the full address (pbx@yourcompany.com) or a whole domain (@3cx.net).`,
        );
  }
  if (next.enabled && !next.token)
    next.token = seal(crypto.randomBytes(24).toString("hex"));
  await saveSettings(next);
  res.json(await view());
});

phoneRouter.post("/token", async (req, res) => {
  const config = await loadSettings();
  await saveSettings({
    ...config,
    token: seal(crypto.randomBytes(24).toString("hex")),
  });
  res.json(await view());
});
