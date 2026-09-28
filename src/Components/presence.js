// Who else is on the same page as you right now, from the live
// connection (see DataProvider.jsx and server/src/live.js).
//
// `presence` is the server's list of { userId, path, since }: one line
// for each person on each page. `now` is passed in (rather than read
// here) so the "here for 3 min" can be updated on a timer.

export function getViewers(presence, team, pathname, myId, now) {
  const viewers = [];
  for (const p of presence) {
    if (p.path !== pathname || p.userId === myId) continue;
    const member = team.find((m) => m.id === p.userId);
    if (!member) continue;
    viewers.push({
      ...member,
      minutes: Math.max(1, Math.round((now - p.since) / 60000)),
    });
  }
  return viewers;
}
