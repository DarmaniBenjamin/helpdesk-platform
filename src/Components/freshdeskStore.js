// A download from Freshdesk, kept in this browser as it goes (IndexedDB),
// so a download that stops part-way (the page closed, the connection
// dropped, Cancel) carries on from where it got to next time, instead of
// starting over. Used by freshdeskApi.js.
//
// One download per Freshdesk address and choice ("the newest 500, with
// notes and replies"). Its parts are kept as they arrive:
//   <key>|part|tickets, |agents, |groups, |contacts, |companies
//   <key>|conv|<ticket number>   one ticket's notes and replies
//   <key>|info                   when it started, and whether it finished
// A finished download is kept too (so the import can be run again without
// downloading again) until Start over, or 7 days.
//
// Nothing here is sent anywhere: it stays in this browser. If the browser
// doesn't allow it (some private windows), downloads just don't resume.

const DB_NAME = "uplink-freshdesk";
const STORE = "downloads";
const KEEP_FOR = 7 * 24 * 60 * 60 * 1000;

let opening = null;
function db() {
  opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("No IndexedDB"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

async function run(mode, work) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const range = (prefix) => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

// The key for one download: the address and what was chosen
export function downloadKey(domain, maxTickets, withConversations) {
  const amount = maxTickets === Infinity ? "all" : String(maxTickets);
  return `${domain}|${amount}|${withConversations ? "notes" : "plain"}`;
}

// What's saved for a download: { startedAt, finished, parts, conversations }
// or null if nothing (or it's older than 7 days, then it's cleared)
export async function downloadInfo(key) {
  try {
    const info = await run("readonly", (s) => s.get(`${key}|info`));
    if (!info) return null;
    if (Date.now() - info.startedAt > KEEP_FOR) {
      await clearDownload(key);
      return null;
    }
    const parts = await run("readonly", (s) => s.getAllKeys(range(`${key}|part|`)));
    const conversations = await run("readonly", (s) => s.count(range(`${key}|conv|`)));
    return {
      ...info,
      parts: parts.map((k) => String(k).split("|").pop()),
      conversations,
    };
  } catch {
    return null;
  }
}

// A store for one download, for fetchEverything (freshdeskApi.js). Every
// method quietly does nothing if the browser won't keep things.
export function downloadStore(key) {
  const safe = (fn, fallback) => async (...args) => {
    try {
      return await fn(...args);
    } catch {
      return fallback;
    }
  };
  return {
    start: safe(async () => {
      const info = await run("readonly", (s) => s.get(`${key}|info`));
      if (!info) await run("readwrite", (s) => s.put({ startedAt: Date.now(), finished: false }, `${key}|info`));
    }),
    part: safe((name) => run("readonly", (s) => s.get(`${key}|part|${name}`)), undefined),
    savePart: safe((name, value) => run("readwrite", (s) => s.put(value, `${key}|part|${name}`))),
    // Every ticket whose notes and replies are already here
    conversationIds: safe(async () => {
      const keys = await run("readonly", (s) => s.getAllKeys(range(`${key}|conv|`)));
      return new Set(keys.map((k) => Number(String(k).split("|").pop())));
    }, new Set()),
    conversation: safe((ticketId) => run("readonly", (s) => s.get(`${key}|conv|${ticketId}`)), undefined),
    saveConversation: safe((ticketId, value) =>
      run("readwrite", (s) => s.put(value, `${key}|conv|${ticketId}`)),
    ),
    finish: safe(async () => {
      const info = (await run("readonly", (s) => s.get(`${key}|info`))) ?? { startedAt: Date.now() };
      await run("readwrite", (s) => s.put({ ...info, finished: true, finishedAt: Date.now() }, `${key}|info`));
    }),
  };
}

// Start over: everything saved for that download is removed
export async function clearDownload(key) {
  try {
    await run("readwrite", (s) => s.delete(range(`${key}|`)));
  } catch {
    // nothing to clear
  }
}
