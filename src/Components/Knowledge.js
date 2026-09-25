// Helpers for Saved Answers (the knowledge base).
// No AI needed: keywords are picked out by counting the useful words.

// Common words that say nothing about the problem
const STOPWORDS = new Set(
  `a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it
  its just me my no not of on or our she so some than that the their them then there these they this to too up us
  was we were what when where which who why will with would you your yes also get got please thanks thank hi hello
  about after again all any because before being both each few more most other own same should very can't don't
  it's i'm we've i've let know see now still since morning today yesterday one two new use using used able anymore
  going looking look into shortly update sure need needs make made work works working keeps way time
  nobody anyone someone everyone everything something anything set correct updated added checked fixed tried`
    .split(/\s+/)
    .filter(Boolean),
);

// Picks the most repeated meaningful words, e.g. "printer offline spooler restart"
export function extractKeywords(text, max = 6) {
  const counts = {};
  const words =
    text.toLowerCase().match(/[a-z0-9][a-z0-9+.#-]*[a-z0-9+#]|[a-z0-9]/g) ?? [];
  for (const word of words) {
    if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    counts[word] = (counts[word] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1]) // most used first
    .slice(0, max)
    .map(([word]) => word);
}

// Does this saved answer match the search text?
export function matchesAnswer(answer, text) {
  if (!text) return true;
  const haystack = [
    answer.title,
    answer.problem,
    answer.solution,
    ...answer.keywords,
  ]
    .join(" ")
    .toLowerCase();
  // Every word typed must appear somewhere
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

// How related an answer is to a ticket: the number of shared keywords
export function relevance(answer, ticketKeywords) {
  return answer.keywords.filter((k) => ticketKeywords.includes(k)).length;
}

// A few answers to start with
function makeAnswer(id, fields, daysAgo) {
  const at = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return {
    id,
    ...fields,
    keywords: extractKeywords(
      `${fields.title} ${fields.title} ${fields.problem} ${fields.solution}`,
    ),
    createdAt: at,
    updatedAt: at,
    uses: Math.floor(daysAgo * 1.7),
  };
}

export const STARTING_ANSWERS = [
  makeAnswer(
    1,
    {
      title: "Outlook keeps asking for the password",
      problem:
        "Outlook pops up a password prompt every few minutes, even after the correct password is entered.",
      solution:
        "Cached credentials were out of date. Closed Outlook, removed the Microsoft entries from Windows Credential Manager, reopened Outlook and signed in again. Prompt stopped.",
      department: "m365",
      ticketId: null,
      author: "Kerry-Ann Joseph",
      source: "manual",
    },
    20,
  ),
  makeAnswer(
    2,
    {
      title: "Printer shows ready but computers say offline",
      problem:
        "Nobody can print; the printer screen says ready but PCs show the printer as offline.",
      solution:
        "Printer had picked up a new IP from DHCP. Set a DHCP reservation for the printer on the router, updated the printer port IP on the PCs, and restarted the Print Spooler service.",
      department: "it",
      ticketId: null,
      author: "Alex Charles",
      source: "manual",
    },
    14,
  ),
  makeAnswer(
    3,
    {
      title: "Branch VPN down",
      problem:
        "Staff at the branch can't reach the head office server; site-to-site VPN shows disconnected.",
      solution:
        "ISP changed the branch's public IP. Updated the remote gateway IP in the VPN settings on both routers and reconnected. Suggested a static IP or DDNS to stop it happening again.",
      department: "net",
      ticketId: null,
      author: "Marcus Pierre",
      source: "manual",
    },
    9,
  ),
  makeAnswer(
    4,
    {
      title: "Nightly backup job failed",
      problem: "Alert email saying last night's backup job failed.",
      solution:
        "Backup target was nearly full and a VSS writer was stuck. Cleared old restore points on the target, restarted the stuck VSS writer's service, and re-ran the backup manually. Completed successfully.",
      department: "srv",
      ticketId: null,
      author: "Shanice Thomas",
      source: "manual",
    },
    6,
  ),
  makeAnswer(
    5,
    {
      title: "Camera shows no picture",
      problem: "One camera on the NVR has been black since yesterday.",
      solution:
        "PoE port on the switch had stopped powering the camera. Moved the camera to another PoE port, then power-cycled the original port. Picture back; logged the faulty port.",
      department: "cctv",
      ticketId: null,
      author: "Marcus Pierre",
      source: "manual",
    },
    3,
  ),
];
