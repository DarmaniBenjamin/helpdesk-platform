// Talking to Freshdesk's API. Freshdesk doesn't let web pages call it
// directly, so requests go through the helpdesk: freshdeskDevProxy.js
// while you're on `npm run dev`, and server/src/freshdesk.js on the live
// site.
// Nothing here writes to Freshdesk. It only reads.

const PER_PAGE = 100; // the most Freshdesk sends per page

// Plain names for what each request reads, so errors say what was blocked
function describe(path) {
  if (path.startsWith("/agents/me")) return "your own agent profile";
  if (path.startsWith("/agents")) return "the list of agents";
  if (path.startsWith("/groups")) return "the list of groups";
  if (/^\/tickets\/\d+\/conversations/.test(path))
    return "a ticket's notes and replies";
  if (path.startsWith("/tickets")) return "tickets";
  if (path.startsWith("/contacts")) return "contacts";
  if (path.startsWith("/companies")) return "companies";
  return path;
}

// An error that also remembers Freshdesk's status number (403, 404…)
function freshdeskError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Waits a number of milliseconds, unless the fetch is cancelled
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    });
  });
}

// Freshdesk allows a set number of calls a minute (50 on a trial, 200 to
// 700 on paid plans), told in every answer (X-RateLimit-Total). Calls are
// spaced evenly to stay under it, instead of using the whole minute's
// allowance in a few seconds and then waiting for the rest of the minute.
// Some calls count as more than one (X-RateLimit-Used-CurrentRequest:
// asking for extra details with include= costs 1 more for each).
const pace = { perMinute: 0, nextAt: 0 };
export const freshdeskPerMinute = () => pace.perMinute;

// One request to Freshdesk. If Freshdesk still says "too many requests"
// (other apps on the account use the same allowance), it waits the time
// Freshdesk asks for and tries again.
async function get(connection, path, { signal, onWait } = {}) {
  for (;;) {
    const early = pace.nextAt - Date.now();
    if (early > 0) await wait(early, signal);
    const response = await fetch(`/freshdesk-api${path}`, {
      signal,
      headers: {
        "x-freshdesk-domain": connection.domain,
        "x-freshdesk-key": connection.apiKey,
      },
    });

    const perMinute = Number(response.headers.get("x-ratelimit-total"));
    if (perMinute > 0) pace.perMinute = perMinute;
    const used = Number(response.headers.get("x-ratelimit-used-currentrequest")) || 1;
    // A little under the limit (95%), so other apps on the account get a share
    if (pace.perMinute) pace.nextAt = Date.now() + (60_000 / (pace.perMinute * 0.95)) * used;

    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after")) || 60;
      onWait?.(seconds);
      await wait(seconds * 1000, signal);
      continue;
    }

    // A web page came back instead: the helpdesk server isn't answering
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/html")) {
      throw new Error(
        "The helpdesk server didn't answer. Check it's running, then try again.",
      );
    }
    if (!type.includes("json")) {
      throw freshdeskError(
        `Freshdesk sent an unexpected answer (error ${response.status}). Try again in a minute.`,
        response.status,
      );
    }

    const body = await response.json();
    if (response.ok) return body;
    if (response.status === 401)
      throw freshdeskError("Freshdesk didn't accept that API key.", 401);
    if (response.status === 403)
      throw freshdeskError(
        `That API key isn't allowed to read ${describe(path)}. In Freshdesk, make the key's agent an Administrator with Global ticket access, or use an admin's API key.`,
        403,
      );
    if (response.status === 404)
      throw freshdeskError(
        `Nothing found at ${connection.domain}.freshdesk.com. Check the address.`,
        404,
      );
    throw freshdeskError(
      body.error ?? body.description ?? "Freshdesk said no.",
      response.status,
    );
  }
}

// Gets every page of a list, 100 at a time, until a page comes back short
// or `limit` items have been collected
async function getAll(connection, path, { limit = Infinity, ...options }) {
  const items = [];
  const joiner = path.includes("?") ? "&" : "?";
  for (let page = 1; items.length < limit; page++) {
    const batch = await get(
      connection,
      `${path}${joiner}per_page=${PER_PAGE}&page=${page}`,
      options,
    );
    items.push(...batch);
    options.onPage?.(items.length);
    if (batch.length < PER_PAGE) break;
  }
  return items.slice(0, limit);
}

// Checks the address and key work. Returns who the key belongs to.
export async function testConnection(connection) {
  const me = await get(connection, "/agents/me");
  return {
    name: me.contact?.name ?? "Freshdesk agent",
    email: me.contact?.email,
  };
}

// Pulls companies, contacts, tickets, agents, groups and (optionally)
// each ticket's notes and replies. `maxTickets` = how many of the newest tickets to get.
// `onProgress` gets a short message to show while it works.
// `store`: where the download is kept as it goes (freshdeskStore.js), so a
// download that stopped carries on where it got to.
export async function fetchEverything(
  connection,
  { maxTickets, withConversations, signal, onProgress, store },
) {
  const onWait = (seconds) =>
    onProgress({
      message: `Freshdesk's allowance for this minute is used up (other apps on your account share it). Carrying on in ${seconds} seconds…`,
    });
  const options = { signal, onWait };
  await store?.start();
  // A part already downloaded comes from the store; otherwise it's
  // downloaded, then kept
  const part = async (name, download) => {
    const kept = await store?.part(name);
    if (kept !== undefined) return kept;
    const value = await download();
    await store?.savePart(name, value);
    return value;
  };

  // 1. Tickets, newest first, with their description and customer.
  // updated_since goes far back, because otherwise Freshdesk only sends
  // the last 30 days.
  onProgress({ message: "Getting tickets…" });
  const tickets = await part("tickets", () =>
    getAll(
      connection,
      "/tickets?include=description,requester&order_by=created_at&order_type=desc&updated_since=2000-01-01T00:00:00Z",
      {
        ...options,
        limit: maxTickets,
        onPage: (n) => onProgress({ message: `Getting tickets… ${n} so far` }),
      },
    ),
  );

  // 2. Agents: who wrote each reply and note, and who each ticket was
  // assigned to (matched to your team by email). Non-admin keys often
  // aren't allowed this list, so if Freshdesk says no, carry on without
  // it instead of stopping the whole import.
  onProgress({ message: "Getting agents…" });
  const agents = await part("agents", async () => {
    try {
      return await getAll(connection, "/agents", options);
    } catch (err) {
      if (err.name === "AbortError" || err.status !== 403) throw err;
      onProgress({
        message:
          "Not allowed to read the agent list, carrying on without agent names…",
      });
      return [];
    }
  });
  const agentNames = new Map(agents.map((a) => [a.id, a.contact?.name]));

  // Groups (Freshdesk's teams), so each ticket can go to the right
  // department here. Same as agents: if it's not allowed, carry on.
  onProgress({ message: "Getting groups…" });
  const groups = await part("groups", async () => {
    try {
      return await getAll(connection, "/groups", options);
    } catch (err) {
      if (err.name === "AbortError" || err.status !== 403) throw err;
      return [];
    }
  });

  // 3. Contacts and companies. For a small test, only the ones on those
  // tickets. For everything, the full lists.
  let contacts;
  let companies;
  if (maxTickets === Infinity) {
    onProgress({ message: "Getting contacts…" });
    contacts = await part("contacts", () =>
      getAll(connection, "/contacts", {
        ...options,
        onPage: (n) => onProgress({ message: `Getting contacts… ${n} so far` }),
      }),
    );
    onProgress({ message: "Getting companies…" });
    companies = await part("companies", () => getAll(connection, "/companies", options));
  } else {
    contacts = await store?.part("contacts");
  }
  if (contacts === undefined) {
    const contactIds = [...new Set(tickets.map((t) => t.requester_id))];
    contacts = [];
    for (const [i, id] of contactIds.entries()) {
      onProgress({
        message: `Getting contacts… ${i + 1} of ${contactIds.length}`,
      });
      try {
        contacts.push(await get(connection, `/contacts/${id}`, options));
      } catch (err) {
        if (err.name === "AbortError") throw err;
        // A deleted contact: fall back to the details on the ticket
        const t = tickets.find((x) => x.requester_id === id);
        if (t?.requester) contacts.push(t.requester);
      }
    }
    await store?.savePart("contacts", contacts);
  }
  if (companies === undefined) companies = await store?.part("companies");
  if (companies === undefined) {
    const companyIds = [
      ...new Set(contacts.map((c) => c.company_id).filter(Boolean)),
    ];
    companies = [];
    for (const id of companyIds) {
      try {
        companies.push(await get(connection, `/companies/${id}`, options));
      } catch (err) {
        if (err.name === "AbortError") throw err;
      }
    }
    await store?.savePart("companies", companies);
  }

  // 4. Notes and replies: one request per ticket, so this is the slow part.
  // Each ticket's are kept as soon as they arrive, so a download that
  // stopped carries on from the next ticket.
  if (withConversations) {
    const already = (await store?.conversationIds()) ?? new Set();
    const left = () => tickets.length - already.size;
    for (const [i, ticket] of tickets.entries()) {
      let conversations = already.has(ticket.id)
        ? await store.conversation(ticket.id)
        : undefined;
      if (conversations === undefined) {
        const perMinute = freshdeskPerMinute();
        const minutes = perMinute ? Math.ceil(left() / (perMinute * 0.95)) : null;
        onProgress({
          message: `Getting notes and replies… ticket ${i + 1} of ${tickets.length}${
            minutes
              ? `, about ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`} left (your Freshdesk plan allows ${perMinute} calls a minute)`
              : ""
          }${already.size ? `. ${already.size} were already downloaded` : ""}`,
          done: i,
          total: tickets.length,
        });
        conversations = await getAll(connection, `/tickets/${ticket.id}/conversations`, options);
        await store?.saveConversation(ticket.id, conversations);
        already.add(ticket.id);
      }
      ticket.conversations = conversations.map((c) => ({
        ...c,
        from_name: c.incoming ? undefined : agentNames.get(c.user_id),
      }));
    }
  }
  await store?.finish();

  // Only what's needed from each agent: their ID, name and email
  const agentList = agents.map((a) => ({
    id: a.id,
    name: a.contact?.name ?? "",
    email: a.contact?.email ?? "",
  }));

  return {
    tickets,
    contacts,
    companies,
    agents: agentList,
    groups: groups.map((g) => ({ id: g.id, name: g.name ?? "" })),
  };
}
