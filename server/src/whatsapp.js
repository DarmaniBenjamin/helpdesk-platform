// WhatsApp: Integrations → WhatsApp. Messages and voice notes sent to the
// agents' WhatsApp Business numbers become tickets for those agents.
//
// It uses Meta's official WhatsApp Business Platform (the Cloud API), in
// "coexistence" mode: each agent keeps using the WhatsApp Business app on
// their phone exactly as before, and the helpdesk gets a copy of every
// message, both ways:
//   - a customer's message: a new ticket for that number's agent, or
//     added to the ticket that conversation is already on (unless it's
//     closed: then a new one). Photos, documents, videos and voice notes
//     come too: voice notes can be played right on the ticket.
//   - what the agent sends from the app ("message echoes"): added to that
//     ticket as their reply, so the ticket shows the whole conversation
//     and the first reply counts for the SLA. Echoes of replies the agent
//     wrote here first ("Send on WhatsApp" on the ticket) aren't added
//     twice.
// The helpdesk only reads: it never sends anything on WhatsApp itself,
// so it costs nothing (Meta only charges for messages businesses send
// through the API).
//
// Connecting: Integrations → WhatsApp needs a Meta app (made once, at
// developers.facebook.com) with WhatsApp and Facebook Login for Business,
// and an Embedded Signup configuration for "WhatsApp Business app
// onboarding". Then each agent's number is connected with "Connect a
// number": Meta's own window opens, the agent signs in, and scans a QR
// code with the WhatsApp Business app on their phone. Numbers that are
// only on the Cloud API (not on a phone) can be added by hand instead,
// with their Phone number ID and a token.
//
// Meta sends every message to the webhook below; it's checked against the
// app secret (X-Hub-Signature-256), so nobody else can make tickets.
//
//   GET  /api/whatsapp/webhook          Meta checks the address (verify token)
//   POST /api/whatsapp/webhook          Meta sends messages (no sign-in: signed)
//   GET  /api/whatsapp                  settings, numbers, agents, teams (Admins)
//   PUT  /api/whatsapp/app              { appId, appSecret, configId }
//   POST /api/whatsapp/numbers/signup   { code, phoneNumberId, wabaId, userId }
//   POST /api/whatsapp/numbers/manual   { phoneNumberId, token, wabaId, userId }
//   PATCH  /api/whatsapp/numbers/:id    { userId, departmentId, enabled }
//   DELETE /api/whatsapp/numbers/:id
import crypto from "node:crypto";
import { Router } from "express";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  customers,
  messages,
  settings,
  whatsappMessages,
  whatsappNumbers,
} from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { MAX_FILE_SIZE } from "./attachments.js";
import { BadInput } from "./validate.js";
import { seal, unseal } from "./secrets.js";
import {
  activeStaff,
  addAgentMessage,
  addCustomerMessage,
  addNote,
  createInboundTicket,
  customerForPhone,
  endingForType,
  existingTeam,
  getTicket,
  prettyPhone,
  saveFile,
  staffList,
  teamList,
} from "./inbound.js";

export const whatsappRouter = Router();

const SETTING = "whatsapp";
// The Graph API version. Meta keeps each one working for about two years.
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}`;

// ---------- Settings ----------

async function loadSettings() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SETTING));
  return {
    appId: "",
    appSecret: null, // locked with secrets.js
    configId: "",
    verifyToken: null,
    lastWebhookAt: null,
    ...(row?.value ?? {}),
  };
}
async function saveSettings(value) {
  await db
    .insert(settings)
    .values({ key: SETTING, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

const open = (sealed) => {
  if (!sealed) return null;
  try {
    return unseal(sealed);
  } catch {
    return null; // locked with a key this server doesn't have any more
  }
};

// ---------- Talking to Meta ----------

async function graph(pathname, { token, method = "GET", body, query } = {}) {
  const url = new URL(`${GRAPH}/${pathname}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new BadInput("Couldn't reach WhatsApp (Meta). Try again in a minute.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new BadInput(
      `WhatsApp said: ${data?.error?.error_user_msg || data?.error?.message || res.statusText}`,
    );
  return data;
}

// A photo, voice note or document someone sent: Meta gives a link to it
// that only works with the number's token
async function downloadMedia(number, mediaId) {
  const token = open(number.token);
  if (!token || !mediaId) return null;
  const info = await graph(mediaId, { token });
  if (!info.url || Number(info.file_size) > MAX_FILE_SIZE) return null;
  const res = await fetch(info.url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  const content = Buffer.from(await res.arrayBuffer());
  if (content.length > MAX_FILE_SIZE) return null;
  return { content, type: info.mime_type || res.headers.get("content-type") };
}

// ---------- What a message says ----------

// The words for the ticket, and the file that came with it (if any)
function describe(msg) {
  const stamp = new Date(Number(msg.timestamp) * 1000 || Date.now())
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "");
  const media = (part, kind, fallbackText, name) =>
    part?.id
      ? {
          text: part.caption?.trim() || fallbackText,
          media: {
            id: part.id,
            type: part.mime_type,
            fileName:
              name ||
              `${kind}-${stamp}.${endingForType(part.mime_type)}`,
          },
        }
      : { text: fallbackText };

  switch (msg.type) {
    case "text":
      return { text: msg.text?.body ?? "" };
    case "image":
      return media(msg.image, "photo", "(Sent a photo)");
    case "video":
      return media(msg.video, "video", "(Sent a video)");
    case "sticker":
      return media(msg.sticker, "sticker", "(Sent a sticker)");
    case "document":
      return media(
        msg.document,
        "document",
        `(Sent a document${msg.document?.filename ? `: ${msg.document.filename}` : ""})`,
        msg.document?.filename,
      );
    case "audio":
      return media(
        msg.audio,
        msg.audio?.voice ? "voice-note" : "audio",
        msg.audio?.voice ? "(Sent a voice note)" : "(Sent an audio file)",
      );
    case "location": {
      const l = msg.location ?? {};
      return {
        text: [
          "📍 Sent a location",
          [l.name, l.address].filter(Boolean).join(", "),
          l.latitude != null
            ? `https://www.google.com/maps?q=${l.latitude},${l.longitude}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    case "contacts":
      return {
        text: [
          "Shared a contact:",
          ...(msg.contacts ?? []).map((c) =>
            [c.name?.formatted_name, ...(c.phones ?? []).map((p) => p.phone)]
              .filter(Boolean)
              .join(", "),
          ),
        ].join("\n"),
      };
    case "button":
      return { text: msg.button?.text ?? "" };
    case "interactive":
      return {
        text:
          msg.interactive?.button_reply?.title ??
          msg.interactive?.list_reply?.title ??
          "",
      };
    default:
      return {
        text: `(Sent a ${msg.type || "kind of"} message the helpdesk can't show. Open WhatsApp to see it.)`,
      };
  }
}

// ---------- Which ticket a conversation is on ----------

// The ticket the conversation with this person on this number is on, if
// it isn't closed (a closed one means a new message starts a new ticket)
async function threadTicket(numberId, waId) {
  const [row] = await db
    .select({ ticketId: whatsappMessages.ticketId })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.numberId, numberId),
        eq(whatsappMessages.waId, waId),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  const ticket = await getTicket(row?.ticketId);
  return ticket && ticket.status !== "closed" ? ticket : null;
}

const seen = async (wamid) =>
  Boolean(
    (
      await db
        .select({ wamid: whatsappMessages.wamid })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.wamid, wamid))
    ).length,
  );

async function remember(wamid, number, waId, ticketId, direction) {
  await db
    .insert(whatsappMessages)
    .values({ wamid, numberId: number.id, waId, ticketId, direction })
    .onConflictDoNothing();
  await db
    .update(whatsappNumbers)
    .set({ lastMessageAt: new Date() })
    .where(eq(whatsappNumbers.id, number.id));
}

// The file that came with a message (photo, document, voice note...),
// saved on it
async function attachMedia(number, ticket, messageId, media, who) {
  if (!media) return;
  const file = await downloadMedia(number, media.id).catch((err) => {
    console.error("WhatsApp media:", err.message);
    return null;
  });
  const saved = file
    ? await saveFile({
        fileName: media.fileName,
        content: file.content,
        ticketId: ticket.id,
        messageId,
      })
    : null;
  if (!saved)
    await addNote(ticket, {
      authorName: "WhatsApp",
      body: `A file ${who} sent couldn't be saved here (too big, or a kind of file that can't be attached). It's still in WhatsApp.`,
      channel: "whatsapp",
    });
}

// ---------- A message from a customer ----------

async function receive(number, msg, profileName) {
  if (!msg?.id || !msg.from || (await seen(msg.id))) return;
  if (["reaction", "system", "ephemeral", "request_welcome"].includes(msg.type))
    return;
  const waId = String(msg.from);
  const at = new Date(Number(msg.timestamp) * 1000 || Date.now());
  const { text, media } = describe(msg);

  let ticket = await threadTicket(number.id, waId);
  let customer = null;
  if (ticket) {
    [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, ticket.customerId));
  }
  customer ??= await customerForPhone(waId, profileName);
  const who = customer.name;

  let messageId;
  if (ticket) {
    messageId = await addCustomerMessage(ticket, {
      authorName: who,
      body: text,
      at,
      reopenedBody: "reopened it by sending a WhatsApp message",
    });
  } else {
    const firstLine = text.split("\n")[0].trim();
    const subject =
      firstLine && !firstLine.startsWith("(")
        ? firstLine.slice(0, 80) + (firstLine.length > 80 ? "…" : "")
        : `WhatsApp message from ${who}`;
    ({ ticket, messageId } = await createInboundTicket({
      customer,
      subject,
      body: text,
      authorName: who,
      source: "whatsapp",
      assigneeId: number.userId,
      departmentId: number.departmentId,
      tags: ["whatsapp"],
      createdBody: `sent a WhatsApp message to ${number.displayNumber || "your number"}`,
      at,
    }));
  }
  await remember(msg.id, number, waId, ticket.id, "in");
  await attachMedia(number, ticket, messageId, media, who);
}

// ---------- What the agent sent from the WhatsApp Business app ----------

async function echo(number, msg) {
  if (!msg?.id || !msg.to || (await seen(msg.id))) return;
  const waId = String(msg.to);
  // Only conversations that are already a ticket: an agent messaging
  // someone first doesn't make one
  const ticket = await threadTicket(number.id, waId);
  if (!ticket) return;
  const at = new Date(Number(msg.timestamp) * 1000 || Date.now());
  const { text, media } = describe(msg);

  // Written here first and sent with "Send on WhatsApp": already on the
  // ticket, so it isn't added again
  const recent = await db
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.ticketId, ticket.id),
        eq(messages.kind, "agent"),
        eq(messages.channel, "whatsapp"),
        gt(messages.createdAt, new Date(at.getTime() - 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(5);
  const same = (a, b) =>
    String(a).replace(/\s+/g, " ").trim() === String(b).replace(/\s+/g, " ").trim();
  if (!media && recent.some((m) => same(m.body, text))) {
    await remember(msg.id, number, waId, ticket.id, "out");
    return;
  }

  const agent = await activeStaff(number.userId);
  const messageId = await addAgentMessage(ticket, {
    authorId: agent?.id ?? null,
    authorName: agent?.name ?? (number.name || "WhatsApp"),
    body: text,
    channel: "whatsapp",
    at,
  });
  await remember(msg.id, number, waId, ticket.id, "out");
  await attachMedia(number, ticket, messageId, media, agent?.name ?? "the agent");
}

// ---------- The webhook (Meta calls this) ----------

// One delivery at a time, in order, so two messages from the same person
// arriving together go on the same ticket
let queue = Promise.resolve();
const oneAtATime = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function handleDelivery(payload) {
  if (payload?.object !== "whatsapp_business_account") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const [number] = await db
        .select()
        .from(whatsappNumbers)
        .where(eq(whatsappNumbers.phoneNumberId, String(phoneNumberId)));
      if (!number?.enabled) continue;

      if (change.field === "messages") {
        const names = new Map(
          (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? ""]),
        );
        for (const msg of value.messages ?? [])
          await receive(number, msg, names.get(msg.from));
      } else if (change.field === "smb_message_echoes") {
        for (const msg of value.message_echoes ?? []) await echo(number, msg);
      }
      // Delivery/read receipts, contact syncs and history aren't needed
    }
  }
}

// Meta checks the address when it's saved in the Meta app
whatsappRouter.get("/webhook", async (req, res) => {
  const config = await loadSettings();
  const token = open(config.verifyToken);
  if (
    req.query["hub.mode"] === "subscribe" &&
    token &&
    req.query["hub.verify_token"] === token
  )
    return res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
  res.status(403).json({ error: "Wrong verify token." });
});

// Mounted in index.js with the raw body (express.raw), which the signature
// is checked against
whatsappRouter.post("/webhook", async (req, res) => {
  const config = await loadSettings();
  const secret = open(config.appSecret);
  if (!secret) return res.status(404).json({ error: "WhatsApp isn't set up." });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const given = String(req.get("x-hub-signature-256") ?? "");
  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  )
    return res.status(401).json({ error: "Not signed by this Meta app." });
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Not JSON." });
  }
  // Answer straight away (Meta sends it again if it waits too long), then
  // make the tickets
  res.sendStatus(200);
  oneAtATime(async () => {
    await handleDelivery(payload);
    if (Date.now() - (config.lastWebhookAt ?? 0) > 60 * 1000)
      await saveSettings({ ...(await loadSettings()), lastWebhookAt: Date.now() });
  }).catch((err) => console.error("WhatsApp webhook:", err));
});

// ---------- Settings (Admins) ----------

// ---------- An agent's own numbers (Integrations, for agents) ----------
// Every member of staff can connect their own WhatsApp Business number
// (once an Admin has set up the Meta app), turn it on or off, or remove
// it. Other people's numbers and the Meta app are for Admins, below.

const mine = requireRole(...STAFF);

async function myNumbers(user) {
  const config = await loadSettings();
  const numbers = await db
    .select()
    .from(whatsappNumbers)
    .where(eq(whatsappNumbers.userId, user.id))
    .orderBy(whatsappNumbers.id);
  return {
    // Ready for "Connect my number": the Meta app is set up
    ready: Boolean(config.appId && config.configId && open(config.appSecret)),
    appId: config.appId,
    configId: config.configId,
    graphVersion: GRAPH.split("/").pop(),
    numbers: numbers.map((n) => ({
      id: n.id,
      displayNumber: n.displayNumber,
      name: n.name,
      coexistence: n.coexistence,
      enabled: n.enabled,
      lastMessageAt: n.lastMessageAt?.getTime() ?? null,
    })),
  };
}

async function myNumber(id, user) {
  const [number] = await db
    .select()
    .from(whatsappNumbers)
    .where(and(eq(whatsappNumbers.id, Number(id) || 0), eq(whatsappNumbers.userId, user.id)));
  if (!number) throw new BadInput("That number isn't yours.", 404);
  return number;
}

whatsappRouter.get("/mine", mine, async (req, res) => {
  res.json(await myNumbers(req.user));
});

whatsappRouter.post("/mine/signup", mine, async (req, res) => {
  await signUpNumber(req.body, req.user.id);
  res.json(await myNumbers(req.user));
});

whatsappRouter.patch("/mine/numbers/:id", mine, async (req, res) => {
  const number = await myNumber(req.params.id, req.user);
  if (req.body?.enabled !== undefined)
    await db
      .update(whatsappNumbers)
      .set({ enabled: Boolean(req.body.enabled) })
      .where(eq(whatsappNumbers.id, number.id));
  res.json(await myNumbers(req.user));
});

whatsappRouter.delete("/mine/numbers/:id", mine, async (req, res) => {
  const number = await myNumber(req.params.id, req.user);
  await db.delete(whatsappNumbers).where(eq(whatsappNumbers.id, number.id));
  res.json(await myNumbers(req.user));
});

whatsappRouter.use(requireRole(...ADMINS));

async function view() {
  const config = await loadSettings();
  const numbers = await db
    .select()
    .from(whatsappNumbers)
    .orderBy(whatsappNumbers.id);
  return {
    appId: config.appId,
    configId: config.configId,
    hasSecret: Boolean(open(config.appSecret)),
    verifyToken: open(config.verifyToken),
    lastWebhookAt: config.lastWebhookAt,
    graphVersion: GRAPH.split("/").pop(),
    numbers: numbers.map((n) => ({
      id: n.id,
      phoneNumberId: n.phoneNumberId,
      displayNumber: n.displayNumber,
      name: n.name,
      userId: n.userId,
      departmentId: n.departmentId,
      coexistence: n.coexistence,
      enabled: n.enabled,
      lastMessageAt: n.lastMessageAt?.getTime() ?? null,
    })),
    agents: await staffList(),
    teams: await teamList(),
  };
}

whatsappRouter.get("/", async (req, res) => {
  const config = await loadSettings();
  // The verify token is made the first time the page is opened
  if (!open(config.verifyToken))
    await saveSettings({
      ...config,
      verifyToken: seal(crypto.randomBytes(18).toString("hex")),
    });
  res.json(await view());
});

whatsappRouter.put("/app", async (req, res) => {
  const config = await loadSettings();
  const appId = String(req.body?.appId ?? "").trim();
  const configId = String(req.body?.configId ?? "").trim();
  const appSecret = String(req.body?.appSecret ?? "").trim();
  if (!/^\d{5,25}$/.test(appId))
    throw new BadInput("The App ID is the long number at the top of your Meta app.");
  if (configId && !/^\d{5,25}$/.test(configId))
    throw new BadInput(
      "The Configuration ID is a long number, from Facebook Login for Business → Configurations.",
    );
  if (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret))
    throw new BadInput(
      "The App secret is 32 letters and numbers, from App settings → Basic.",
    );
  if (!appSecret && !open(config.appSecret))
    throw new BadInput("Paste the App secret too.");
  await saveSettings({
    ...config,
    appId,
    configId,
    ...(appSecret ? { appSecret: seal(appSecret) } : {}),
  });
  res.json(await view());
});

// Saves a number once Meta has said it's ready, and asks Meta to send its
// messages here
async function addNumber({ phoneNumberId, wabaId, token, userId, coexistence }) {
  const agent = userId ? await activeStaff(userId) : null;
  if (userId && !agent) throw new BadInput("Pick who this number belongs to.");
  const info = await graph(String(phoneNumberId), {
    token,
    query: { fields: "display_phone_number,verified_name" },
  });
  if (wabaId) await graph(`${wabaId}/subscribed_apps`, { token, method: "POST" });
  const values = {
    phoneNumberId: String(phoneNumberId),
    wabaId: String(wabaId ?? ""),
    displayNumber: prettyPhone(info.display_phone_number) || info.display_phone_number || "",
    name: String(info.verified_name ?? "").slice(0, 100),
    userId: agent?.id ?? null,
    token: seal(token),
    coexistence,
    enabled: true,
  };
  await db
    .insert(whatsappNumbers)
    .values(values)
    .onConflictDoUpdate({ target: whatsappNumbers.phoneNumberId, set: values });
}

// The agent finished Meta's window ("Embedded Signup"): the page sends the
// one-time code it got, which becomes the number's lasting token
whatsappRouter.post("/numbers/signup", async (req, res) => {
  await signUpNumber(req.body, req.body?.userId || null);
  res.json(await view());
});

// The agent finished Meta's window: the one-time code becomes the
// number's lasting token. userId: whose number it is.
async function signUpNumber(body, userId) {
  const config = await loadSettings();
  const secret = open(config.appSecret);
  if (!config.appId || !secret)
    throw new BadInput("Save the Meta app's details first.");
  const code = String(body?.code ?? "");
  const phoneNumberId = String(body?.phoneNumberId ?? "");
  const wabaId = String(body?.wabaId ?? "");
  if (!code || !/^\d+$/.test(phoneNumberId) || !/^\d+$/.test(wabaId))
    throw new BadInput(
      "Meta's window didn't finish. Try again, and go through every step to the end.",
    );
  const exchanged = await graph("oauth/access_token", {
    query: { client_id: config.appId, client_secret: secret, code },
  });
  if (!exchanged.access_token)
    throw new BadInput("Meta didn't give a token. Try connecting again.");
  await addNumber({
    phoneNumberId,
    wabaId,
    token: exchanged.access_token,
    userId,
    coexistence: true,
  });
}

// A number added by hand: its Phone number ID and a lasting token (a
// System User token from Meta Business Settings)
whatsappRouter.post("/numbers/manual", async (req, res) => {
  const phoneNumberId = String(req.body?.phoneNumberId ?? "").trim();
  const wabaId = String(req.body?.wabaId ?? "").trim();
  const token = String(req.body?.token ?? "").trim();
  if (!/^\d{5,25}$/.test(phoneNumberId))
    throw new BadInput("The Phone number ID is a long number, from WhatsApp → API Setup.");
  if (wabaId && !/^\d{5,25}$/.test(wabaId))
    throw new BadInput("The WhatsApp Business Account ID is a long number.");
  if (token.length < 20) throw new BadInput("Paste the access token.");
  await addNumber({
    phoneNumberId,
    wabaId,
    token,
    userId: req.body?.userId || null,
    coexistence: false,
  });
  res.json(await view());
});

whatsappRouter.patch("/numbers/:id", async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [number] = await db
    .select()
    .from(whatsappNumbers)
    .where(eq(whatsappNumbers.id, id));
  if (!number) throw new BadInput("That number isn't connected any more.", 404);
  const set = {};
  const b = req.body ?? {};
  if (b.userId !== undefined) {
    const agent = b.userId ? await activeStaff(b.userId) : null;
    if (b.userId && !agent) throw new BadInput("That person isn't on the team.");
    set.userId = agent?.id ?? null;
  }
  if (b.departmentId !== undefined) {
    set.departmentId = b.departmentId ? await existingTeam(b.departmentId) : null;
    if (b.departmentId && !set.departmentId)
      throw new BadInput("That team doesn't exist any more.");
  }
  if (b.enabled !== undefined) set.enabled = Boolean(b.enabled);
  if (Object.keys(set).length)
    await db.update(whatsappNumbers).set(set).where(eq(whatsappNumbers.id, id));
  res.json(await view());
});

// Stops the helpdesk reading the number. Tickets it made stay. (To take
// it off the Cloud API completely, disconnect it in the WhatsApp Business
// app: Settings → Account → Business Platform.)
whatsappRouter.delete("/numbers/:id", async (req, res) => {
  await db
    .delete(whatsappNumbers)
    .where(eq(whatsappNumbers.id, Number(req.params.id) || 0));
  res.json(await view());
});
