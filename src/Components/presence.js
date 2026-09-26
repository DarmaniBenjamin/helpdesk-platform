// Who else is on the same page as you right now.
//
// For now this is pretend: it picks some of your active teammates based on
// the page's address, so each page always shows the same people (and some
// pages, like the Dashboard, show nobody).
// Once the backend exists, every open tab will tell the server which page
// it's on over a live connection, and this list will be the real thing.

// Turns text into a well-mixed number, always the same for the same text
function hash(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Your teammates on this page, each with how many minutes they've been here
export function getViewers(team, pathname, myId) {
  return team
    .filter(
      (m) => m.status === "active" && m.role !== "customer" && m.id !== myId,
    )
    .filter((m) => hash(`${pathname}|${m.id}`) % 3 === 0)
    .map((m) => ({ ...m, minutes: (hash(`${m.id}|${pathname}`) % 25) + 1 }));
}
