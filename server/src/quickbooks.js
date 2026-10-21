// QuickBooks Online: draft invoices for billable tickets.
//
// When a ticket is made, "Bill in QuickBooks" can be ticked (or later, on
// the ticket). Once that ticket is closed, a draft invoice is made in
// QuickBooks for its customer: "Ticket #N – subject", the fix from the
// notes, and one $0 line. It's never emailed from here: someone opens it
// in QuickBooks, puts in the hours, parts and prices, and sends it from
// there. The ticket shows the invoice number, a link, and paid/unpaid.
//
// Setting up (Integrations → QuickBooks, Admins):
//   1. An app on developer.intuit.com gives a Client ID and Secret, with
//      this site's /api/quickbooks/callback as its Redirect URI.
//   2. "Connect to QuickBooks" signs in to Intuit and picks the company.
//      The sign-in is kept (encrypted) and renewed by itself: Intuit's
//      access lasts an hour, the refresh token 100 days from last use.
//   Sandbox (a test company) or Production (the real one) is chosen with
//   the keys: Intuit gives different keys for each.
//
//   GET    /api/quickbooks              the settings and connection (Admins)
//   PUT    /api/quickbooks/app          { clientId, clientSecret, environment, itemId }
//   POST   /api/quickbooks/connect      → { url } to send the browser to Intuit
//   GET    /api/quickbooks/callback     Intuit sends the browser back here
//   DELETE /api/quickbooks              disconnect
//   GET    /api/quickbooks/items        the products/services, for the draft line
//   GET    /api/tickets/:id/quickbooks  the invoice's number, total, balance (staff)
//   POST   /api/tickets/:id/quickbooks  make the draft invoice now (Admins)
import crypto from "node:crypto";
import { Router } from "express";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "./db/index.js";
import { customers, messages, settings, tickets, users } from "./db/schema.js";
import { requireRole } from "./auth.js";
import { ADMINS, STAFF } from "./permissions.js";
import { BadInput, cleanText } from "./validate.js";
import { seal, unseal, sign } from "./secrets.js";
import { siteAddress } from "./notices.js";
import { notify } from "./notify.js";
import { recordEvent } from "./activity.js";
import { sendToEveryone } from "./live.js";

const MINUTE = 60 * 1000;
// Intuit's addresses (the QUICKBOOKS_* overrides are only for tests)
const OAUTH_AUTHORIZE =
  process.env.QUICKBOOKS_AUTHORIZE_URL ||
  "https://appcenter.intuit.com/connect/oauth2";
const OAUTH_TOKEN =
  process.env.QUICKBOOKS_TOKEN_URL ||
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const OAUTH_REVOKE =
  process.env.QUICKBOOKS_REVOKE_URL ||
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const API = {
  sandbox:
    process.env.QUICKBOOKS_API_SANDBOX ||
    "https://sandbox-quickbooks.api.intuit.com",
  production:
    process.env.QUICKBOOKS_API_PRODUCTION ||
    "https://quickbooks.api.intuit.com",
};
// Where an invoice opens in QuickBooks
const APP = {
  sandbox: "https://app.sandbox.qbo.intuit.com/app/invoice?txnId=",
  production: "https://qbo.intuit.com/app/invoice?txnId=",
};
const MINOR_VERSION = 75;
const SCOPE = "com.intuit.quickbooks.accounting";

// ---------- Settings ----------
// settings "quickbooks": { clientId, clientSecret (sealed), environment,
// itemId, realmId, refreshToken (sealed), companyName, connectedAt,
// connectedBy, refreshExpiresAt, since }

async function load() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "quickbooks"));
  return row?.value ?? {};
}
async function save(value) {
  await db
    .insert(settings)
    .values({ key: "quickbooks", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

const callbackUrl = (req) => `${siteAddress(req)}/api/quickbooks/callback`;

// Is it set up and connected? (for the Add Ticket tick box)
export async function quickbooksReady() {
  const q = await load();
  return Boolean(q.clientId && q.realmId && q.refreshToken);
}

function publicSettings(q, req) {
  return {
    environment: q.environment ?? "sandbox",
    clientId: q.clientId ?? "",
    hasSecret: Boolean(q.clientSecret),
    itemId: q.itemId ?? "",
    connected: Boolean(q.realmId && q.refreshToken),
    companyName: q.companyName ?? "",
    connectedAt: q.connectedAt ?? null,
    connectedBy: q.connectedBy ?? "",
    refreshExpiresAt: q.refreshExpiresAt ?? null,
    redirectUri: callbackUrl(req),
  };
}

// ---------- Talking to Intuit ----------

// Plain words for what Intuit said
function intuitError(json, status) {
  const fault = json?.Fault?.Error?.[0] ?? json?.fault?.error?.[0];
  if (fault)
    return `${fault.Message ?? fault.message}${fault.Detail || fault.detail ? `: ${fault.Detail ?? fault.detail}` : ""}`;
  if (json?.error === "invalid_grant")
    return "QuickBooks says the connection has run out or was removed. Connect to QuickBooks again (Integrations → QuickBooks).";
  if (json?.error === "invalid_client")
    return "QuickBooks didn't accept the Client ID or Secret. Check them in Integrations → QuickBooks.";
  if (json?.error_description || json?.error)
    return json.error_description || json.error;
  if (status === 401)
    return "QuickBooks said this connection isn't allowed. Connect again.";
  return `QuickBooks answered with an error (status ${status}).`;
}

async function tokenRequest(q, params) {
  const basic = Buffer.from(`${q.clientId}:${unseal(q.clientSecret)}`).toString(
    "base64",
  );
  let res;
  try {
    res = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(20 * 1000),
    });
  } catch {
    throw new BadInput(
      "Couldn't reach QuickBooks. Try again in a minute.",
      502,
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token)
    throw new BadInput(intuitError(json, res.status), 502);
  return json;
}

// One fresh access token at a time, kept until a few minutes before it
// runs out. A new refresh token comes back each time: it's saved.
let access = null; // { token, until, realmId }
let refreshing = null;
async function accessToken() {
  if (access && access.until > Date.now() + 2 * MINUTE) return access;
  refreshing ??= (async () => {
    const q = await load();
    if (!q.realmId || !q.refreshToken)
      throw new BadInput(
        "QuickBooks isn't connected yet (Integrations → QuickBooks).",
        409,
      );
    const json = await tokenRequest(q, {
      grant_type: "refresh_token",
      refresh_token: unseal(q.refreshToken),
    });
    await save({
      ...q,
      refreshToken: seal(json.refresh_token),
      refreshExpiresAt:
        Date.now() + (json.x_refresh_token_expires_in ?? 0) * 1000,
    });
    access = {
      token: json.access_token,
      until: Date.now() + (json.expires_in ?? 3600) * 1000,
      realmId: q.realmId,
      environment: q.environment ?? "sandbox",
    };
    return access;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// A call to the QuickBooks Accounting API, e.g. qbo("GET", "/companyinfo/1")
async function qbo(method, path, body) {
  const a = await accessToken();
  const url = new URL(
    `${API[a.environment]}/v3/company/${encodeURIComponent(a.realmId)}${path}`,
  );
  url.searchParams.set("minorversion", String(MINOR_VERSION));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${a.token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30 * 1000),
    });
  } catch {
    throw new BadInput(
      "Couldn't reach QuickBooks. Try again in a minute.",
      502,
    );
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401) access = null; // ask for a new one next time
  if (!res.ok) throw new BadInput(intuitError(json, res.status), 502);
  return json;
}

// A QuickBooks query, e.g. "select * from Item where Active = true"
const escape = (text) =>
  String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function query(text) {
  const json = await qbo("GET", `/query?query=${encodeURIComponent(text)}`);
  return json?.QueryResponse ?? {};
}

// ---------- Customers and invoices ----------

// The customer in QuickBooks: the one remembered from before, else one
// with the same email, else the same name, else a new one
async function qboCustomerFor(customer) {
  if (customer.qboCustomerId) {
    try {
      const found = await qbo(
        "GET",
        `/customer/${encodeURIComponent(customer.qboCustomerId)}`,
      );
      if (found?.Customer?.Active !== false) return found.Customer.Id;
    } catch {
      // removed in QuickBooks: look again
    }
  }
  const remember = async (id) => {
    await db
      .update(customers)
      .set({ qboCustomerId: id })
      .where(eq(customers.id, customer.id));
    return id;
  };
  if (customer.email) {
    const r = await query(
      `select * from Customer where PrimaryEmailAddr = '${escape(customer.email)}'`,
    ).catch(() => ({}));
    if (r.Customer?.[0]) return remember(r.Customer[0].Id);
  }
  const displayName = (customer.company || customer.name || "Customer").slice(
    0,
    100,
  );
  const byName = await query(
    `select * from Customer where DisplayName = '${escape(displayName)}'`,
  );
  if (byName.Customer?.[0]) return remember(byName.Customer[0].Id);
  const created = await qbo("POST", "/customer", {
    DisplayName: displayName,
    ...(customer.company
      ? { CompanyName: customer.company.slice(0, 100) }
      : {}),
    ...(customer.company && customer.name
      ? {
          GivenName: customer.name.split(" ")[0].slice(0, 100),
          FamilyName:
            customer.name.split(" ").slice(1).join(" ").slice(0, 100) ||
            undefined,
        }
      : {}),
    ...(customer.email
      ? { PrimaryEmailAddr: { Address: customer.email } }
      : {}),
    ...(customer.phone
      ? { PrimaryPhone: { FreeFormNumber: customer.phone.slice(0, 30) } }
      : {}),
  });
  return remember(created.Customer.Id);
}

// The product/service for the $0 line: the one chosen in the settings,
// else one called "Services", else the first service there is
async function draftItem(q) {
  if (q.itemId) return q.itemId;
  const services = await query(
    "select * from Item where Active = true and Type = 'Service' maxresults 50",
  );
  const list = services.Item ?? [];
  const pick = list.find((i) => /^services?$/i.test(i.Name)) ?? list[0];
  if (pick) return pick.Id;
  const any = await query(
    "select * from Item where Active = true maxresults 1",
  );
  if (any.Item?.[0]) return any.Item[0].Id;
  throw new BadInput(
    'QuickBooks has no products or services to put on the invoice. Add one (e.g. "Services") in QuickBooks first.',
  );
}

// What goes on the invoice: the ticket, and the fix from its notes
async function describe(ticket) {
  const notes = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.ticketId, ticket.id), eq(messages.kind, "note")))
    .orderBy(asc(messages.createdAt));
  const fix = notes
    .map((n) => n.body.trim())
    .filter(Boolean)
    .join("\n");
  const line = `Ticket #${ticket.id} – ${ticket.subject}`;
  // QuickBooks allows 4000 characters on a line's description
  return (fix ? `${line}\n${fix}` : line).slice(0, 3900);
}

const invoiceLink = (environment, id) =>
  `${APP[environment] ?? APP.production}${encodeURIComponent(id)}`;

// Makes the draft invoice for a ticket. Returns the ticket row, updated.
// Throws in plain words if QuickBooks says no (and saves why on the ticket).
export async function makeDraftInvoice(ticketId, actor = null) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  if (!ticket) throw new BadInput("That ticket doesn't exist.", 404);
  if (ticket.qboInvoiceId) return ticket; // already done
  const q = await load();
  try {
    if (!q.realmId)
      throw new BadInput(
        "QuickBooks isn't connected yet (Integrations → QuickBooks).",
        409,
      );
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, ticket.customerId));
    const customerRef = await qboCustomerFor(customer);
    const itemId = await draftItem(q);
    const created = await qbo("POST", "/invoice", {
      CustomerRef: { value: customerRef },
      Line: [
        {
          DetailType: "SalesItemLineDetail",
          Amount: 0,
          Description: await describe(ticket),
          SalesItemLineDetail: {
            ItemRef: { value: itemId },
            Qty: 1,
            UnitPrice: 0,
          },
        },
      ],
      // Only staff see the private note; the customer sees the memo
      PrivateNote:
        `Made by Uplink from ticket #${ticket.id}. Add the hours, parts and prices, then send it.`.slice(
          0,
          4000,
        ),
      CustomerMemo: {
        value: `Ticket #${ticket.id}: ${ticket.subject}`.slice(0, 1000),
      },
      ...(customer.email ? { BillEmail: { Address: customer.email } } : {}),
      // Not sent by itself: someone sends it from QuickBooks
      EmailStatus: "NotSet",
    });
    const inv = created.Invoice;
    const [after] = await db
      .update(tickets)
      .set({
        qboInvoiceId: inv.Id,
        qboInvoiceNumber: inv.DocNumber ?? inv.Id,
        qboError: null,
      })
      .where(eq(tickets.id, ticket.id))
      .returning();
    await recordEvent({
      ticket: after,
      actor: actor ?? { id: null, name: "QuickBooks" },
      type: "quickbooks",
      body: `made draft invoice ${inv.DocNumber ?? inv.Id} in QuickBooks`,
    });
    sendToEveryone("changed", {
      resource: "tickets",
      id: ticket.id,
      customerId: ticket.customerId,
    });
    return after;
  } catch (err) {
    const why = String(err.message ?? err).slice(0, 500);
    await db
      .update(tickets)
      .set({ qboError: why })
      .where(eq(tickets.id, ticket.id));
    sendToEveryone("changed", {
      resource: "tickets",
      id: ticket.id,
      customerId: ticket.customerId,
    });
    throw err;
  }
}

// ---------- Closed tickets → draft invoices ----------

// Every minute: closed tickets with "Bill in QuickBooks" ticked, closed
// at least a minute ago (so closing by mistake and reopening makes
// nothing), and no invoice or error yet. Tickets closed before
// QuickBooks was connected aren't touched.
let running = false;
async function invoiceClosedTickets() {
  if (running) return;
  running = true;
  try {
    const q = await load();
    if (!q.realmId || !q.refreshToken || !q.since) return;
    const due = await db
      .select({ id: tickets.id, subject: tickets.subject })
      .from(tickets)
      .where(
        and(
          eq(tickets.status, "closed"),
          eq(tickets.billInQuickbooks, true),
          isNull(tickets.qboInvoiceId),
          isNull(tickets.qboError),
          gt(tickets.closedAt, new Date(q.since)),
        ),
      )
      .orderBy(asc(tickets.id))
      .limit(10);
    for (const t of due) {
      const [ticket] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, t.id));
      if (!ticket || ticket.closedAt > new Date(Date.now() - MINUTE)) continue;
      try {
        await makeDraftInvoice(t.id);
      } catch (err) {
        // The Admins hear about it (it's saved on the ticket, with Try again)
        const ids = (
          await db
            .select({ id: users.id })
            .from(users)
            .where(and(inArray(users.role, ADMINS), eq(users.status, "active")))
        ).map((u) => u.id);
        await notify(ids, {
          kind: "quickbooks",
          title: `QuickBooks invoice for #${t.id} wasn't made`,
          body: String(err.message ?? err).slice(0, 200),
          ticketId: t.id,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("QuickBooks:", err.message);
  } finally {
    running = false;
  }
}

export function startQuickbooksInvoices() {
  const run = () => invoiceClosedTickets();
  setTimeout(run, 25 * 1000).unref();
  setInterval(run, MINUTE).unref();
}

// ---------- Routes: the settings ----------

export const quickbooksRouter = Router();
const admins = requireRole(...ADMINS);

quickbooksRouter.get("/", admins, async (req, res) => {
  res.json(publicSettings(await load(), req));
});

quickbooksRouter.put("/app", admins, async (req, res) => {
  const q = await load();
  const b = req.body ?? {};
  const environment = b.environment === "production" ? "production" : "sandbox";
  const clientId = cleanText(b.clientId, {
    label: "Client ID",
    max: 200,
    required: true,
  });
  const secret = cleanText(b.clientSecret, {
    label: "Client Secret",
    max: 200,
  });
  if (!secret && !q.clientSecret)
    throw new BadInput("Paste the Client Secret too.");
  const changedKeys =
    clientId !== q.clientId ||
    Boolean(secret) ||
    environment !== (q.environment ?? "sandbox");
  const next = {
    ...q,
    clientId,
    environment,
    itemId: cleanText(b.itemId ?? q.itemId ?? "", {
      label: "Product/service",
      max: 50,
    }),
    ...(secret ? { clientSecret: seal(secret) } : {}),
  };
  // New keys or another environment: the old connection doesn't fit them
  if (changedKeys && q.realmId) {
    delete next.realmId;
    delete next.refreshToken;
    delete next.companyName;
    access = null;
  }
  await save(next);
  res.json(publicSettings(next, req));
});

// The browser goes to Intuit with a signed "state", so only a sign-in
// started here, by this person, can come back and be saved
quickbooksRouter.post("/connect", admins, async (req, res) => {
  const q = await load();
  if (!q.clientId || !q.clientSecret)
    throw new BadInput("Save the Client ID and Secret first.");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = `${req.user.id}.${Date.now()}.${nonce}`;
  const url = new URL(OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", q.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", callbackUrl(req));
  url.searchParams.set("state", `${state}.${sign(`qbo:${state}`)}`);
  res.json({ url: url.toString() });
});

function back(res, message, ok) {
  const params = new URLSearchParams({
    quickbooks: ok ? "connected" : "error",
    ...(ok ? {} : { why: message }),
  });
  res.redirect(`/integrations?${params}#quickbooks`);
}

quickbooksRouter.get("/callback", async (req, res) => {
  const { code, state = "", realmId, error } = req.query;
  if (error)
    return back(
      res,
      error === "access_denied"
        ? "The connection was cancelled."
        : String(error),
      false,
    );
  const parts = String(state).split(".");
  const signature = parts.pop();
  const raw = parts.join(".");
  const [userId, at] = parts;
  const expected = sign(`qbo:${raw}`);
  const signedOk =
    signature &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!signedOk || Date.now() - Number(at) > 15 * MINUTE)
    return back(
      res,
      "That sign-in link had run out. Press Connect to QuickBooks again.",
      false,
    );
  if (!req.user || req.user.id !== userId || !ADMINS.includes(req.user.role))
    return back(
      res,
      "Sign in to Uplink as the same Admin, then connect again.",
      false,
    );
  if (!code || !realmId)
    return back(
      res,
      "QuickBooks didn't send the company back. Try again.",
      false,
    );
  try {
    const q = await load();
    const json = await tokenRequest(q, {
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: callbackUrl(req),
    });
    const next = {
      ...q,
      realmId: String(realmId),
      refreshToken: seal(json.refresh_token),
      refreshExpiresAt:
        Date.now() + (json.x_refresh_token_expires_in ?? 0) * 1000,
      connectedAt: Date.now(),
      connectedBy: req.user.name ?? "",
      // Only tickets closed from now on are invoiced
      since: q.since ?? Date.now(),
    };
    await save(next);
    access = {
      token: json.access_token,
      until: Date.now() + (json.expires_in ?? 3600) * 1000,
      realmId: next.realmId,
      environment: next.environment ?? "sandbox",
    };
    const info = await qbo(
      "GET",
      `/companyinfo/${encodeURIComponent(next.realmId)}`,
    ).catch(() => null);
    if (info?.CompanyInfo?.CompanyName)
      await save({ ...next, companyName: info.CompanyInfo.CompanyName });
    back(res, "", true);
  } catch (err) {
    back(res, err.message, false);
  }
});

quickbooksRouter.delete("/", admins, async (req, res) => {
  const q = await load();
  if (q.refreshToken) {
    // Tell Intuit too (best effort)
    await fetch(OAUTH_REVOKE, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${q.clientId}:${unseal(q.clientSecret)}`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: unseal(q.refreshToken) }),
      signal: AbortSignal.timeout(10 * 1000),
    }).catch(() => {});
  }
  const next = { ...q };
  for (const k of [
    "realmId",
    "refreshToken",
    "companyName",
    "connectedAt",
    "connectedBy",
    "refreshExpiresAt",
  ])
    delete next[k];
  access = null;
  await save(next);
  res.json(publicSettings(next, req));
});

// The products/services, to choose the one on the draft line
quickbooksRouter.get("/items", admins, async (req, res) => {
  const r = await query(
    "select * from Item where Active = true maxresults 200",
  );
  res.json(
    (r.Item ?? [])
      .filter((i) => i.Type !== "Category")
      .map((i) => ({
        id: i.Id,
        name: i.FullyQualifiedName ?? i.Name,
        type: i.Type,
      })),
  );
});

// ---------- Routes: a ticket's invoice ----------

export const ticketInvoiceRouter = Router({ mergeParams: true });

async function ticketRow(id) {
  const [t] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, Number(id) || 0));
  if (!t) throw new BadInput("That ticket doesn't exist.", 404);
  return t;
}

// Its number, total, what's still owed, and the link
ticketInvoiceRouter.get("/", requireRole(...STAFF), async (req, res) => {
  const t = await ticketRow(req.params.id);
  if (!t.qboInvoiceId) return res.json({ invoice: null, error: t.qboError });
  const q = await load();
  let status = null;
  try {
    const json = await qbo(
      "GET",
      `/invoice/${encodeURIComponent(t.qboInvoiceId)}`,
    );
    const inv = json.Invoice;
    status = {
      total: inv.TotalAmt,
      balance: inv.Balance,
      currency: inv.CurrencyRef?.value ?? "",
      emailed: inv.EmailStatus === "EmailSent",
      paid: inv.TotalAmt > 0 && inv.Balance === 0,
    };
  } catch {
    // QuickBooks not reachable right now: the number and link still work
  }
  res.json({
    invoice: {
      id: t.qboInvoiceId,
      number: t.qboInvoiceNumber,
      link: invoiceLink(q.environment ?? "sandbox", t.qboInvoiceId),
      ...status,
    },
    error: null,
  });
});

// Make it now (or try again after an error)
ticketInvoiceRouter.post("/", requireRole(...ADMINS), async (req, res) => {
  const t = await ticketRow(req.params.id);
  if (!t.billInQuickbooks)
    await db
      .update(tickets)
      .set({ billInQuickbooks: true })
      .where(eq(tickets.id, t.id));
  await db.update(tickets).set({ qboError: null }).where(eq(tickets.id, t.id));
  const after = await makeDraftInvoice(t.id, req.user);
  const q = await load();
  res.status(201).json({
    invoice: {
      id: after.qboInvoiceId,
      number: after.qboInvoiceNumber,
      link: invoiceLink(q.environment ?? "sandbox", after.qboInvoiceId),
    },
  });
});
