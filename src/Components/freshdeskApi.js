// Talking to Freshdesk's API (through freshdeskDevProxy.js while you're on
// `npm run dev`, and through the backend later).
// Nothing here writes to Freshdesk. It only reads.

const PER_PAGE = 100; // the most Freshdesk sends per page

// Plain names for what each request reads, so errors say what was blocked
function describe(path) {
  if (path.startsWith("/agents/me")) return "your own agent profile";
  if (path.startsWith("/agents")) return "the list of agents";
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

// One request to Freshdesk. If Freshdesk says "too many requests" (you
// only get a set number per minute), it waits the time Freshdesk asks
// for and tries again.
async function get(connection, path, { signal, onWait } = {}) {
  for (;;) {
    const response = await fetch(`/freshdesk-api${path}`, {
      signal,
      headers: {
        "x-freshdesk-domain": connection.domain,
        "x-freshdesk-key": connection.apiKey,
      },
    });

    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after")) || 60;
      onWait?.(seconds);
      await wait(seconds * 1000, signal);
      continue;
    }

    // The built website has no helper to talk to, and gets a web page back
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/html")) {
      throw new Error(
        "Connecting only works while running npm run dev on your computer, until the backend is built.",
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

// Pulls companies, contacts, tickets and (optionally) each ticket's notes
// and replies. `maxTickets` = how many of the newest tickets to get.
// `onProgress` gets a short message to show while it works.
export async function fetchEverything(
  connection,
  { maxTickets, withConversations, signal, onProgress },
) {
  const onWait = (seconds) =>
    onProgress({
      message: `Freshdesk asked us to slow down. Carrying on in ${seconds} seconds…`,
    });
  const options = { signal, onWait };

  // 1. Tickets, newest first, with their description and customer.
  // updated_since goes far back, because otherwise Freshdesk only sends
  // the last 30 days.
  onProgress({ message: "Getting tickets…" });
  const tickets = await getAll(
    connection,
    "/tickets?include=description,requester&order_by=created_at&order_type=desc&updated_since=2000-01-01T00:00:00Z",
    {
      ...options,
      limit: maxTickets,
      onPage: (n) => onProgress({ message: `Getting tickets… ${n} so far` }),
    },
  );

  // 2. Agents, so replies and notes show who wrote them. Non-admin keys
  // often aren't allowed this list, so if Freshdesk says no, carry on
  // without names instead of stopping the whole import.
  onProgress({ message: "Getting agents…" });
  let agents = [];
  try {
    agents = await getAll(connection, "/agents", options);
  } catch (err) {
    if (err.name === "AbortError" || err.status !== 403) throw err;
    onProgress({
      message:
        "Not allowed to read the agent list, carrying on without agent names…",
    });
  }
  const agentNames = new Map(agents.map((a) => [a.id, a.contact?.name]));

  // 3. Contacts and companies. For a small test, only the ones on those
  // tickets. For everything, the full lists.
  let contacts;
  let companies;
  if (maxTickets === Infinity) {
    onProgress({ message: "Getting contacts…" });
    contacts = await getAll(connection, "/contacts", {
      ...options,
      onPage: (n) => onProgress({ message: `Getting contacts… ${n} so far` }),
    });
    onProgress({ message: "Getting companies…" });
    companies = await getAll(connection, "/companies", options);
  } else {
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
        // A deleted or blocked contact: fall back to the details on the ticket
        const t = tickets.find((x) => x.requester_id === id);
        if (t?.requester) contacts.push(t.requester);
      }
    }
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
  }

  // 4. Notes and replies: one request per ticket, so this is the slow part
  if (withConversations) {
    for (const [i, ticket] of tickets.entries()) {
      onProgress({
        message: `Getting notes and replies… ticket ${i + 1} of ${tickets.length}`,
        done: i,
        total: tickets.length,
      });
      const conversations = await getAll(
        connection,
        `/tickets/${ticket.id}/conversations`,
        options,
      );
      ticket.conversations = conversations.map((c) => ({
        ...c,
        from_name: c.incoming ? undefined : agentNames.get(c.user_id),
      }));
    }
  }

  return { tickets, contacts, companies };
}
