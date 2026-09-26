// Who else is on the same page as you right now.
//
// For now this is pretend: it picks some of your active teammates based on
// the page's address, so each page always shows the same people.
// Once the backend exists, every open tab will tell the server which page
// it's on over a live connection, and this list will be the real thing.

// Turns text into a number, always the same number for the same text
function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// Your teammates on this page, each with how many minutes they've been here
export function getViewers(team, pathname, myId) {
  return team
    .filter(
      (m) => m.status === "active" && m.role !== "customer" && m.id !== myId,
    )
    .filter((m) => hash(pathname + m.id) % 3 === 0)
    .map((m) => ({ ...m, minutes: (hash(m.id + pathname) % 25) + 1 }));
}
