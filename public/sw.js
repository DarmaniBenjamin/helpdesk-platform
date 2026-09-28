// The service worker: a small script the browser keeps running in the
// background, even when the helpdesk tab is closed. It receives push
// messages from the server and shows them as real notifications (the
// Windows notification centre, macOS Notification Centre, phones).
//
// It lives in "public" so it's served as /sw.js. It can't import
// anything from src.

self.addEventListener("install", () => {
  // Use a new version of this file straight away
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A message from the server (see server/src/notify.js)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "DeskFlow", {
      body: data.body || "",
      tag: data.tag, // a newer one for the same ticket replaces the old one
      data: { url: data.url || "/" },
    }),
  );
});

// Clicking a notification: bring the app forward on that ticket, or
// open it if it isn't open anywhere
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = windows.find(
        (w) => new URL(w.url).origin === self.location.origin,
      );
      if (open) {
        // The app moves to the page itself (see DataProvider.jsx)
        open.postMessage({ type: "open", path });
        return open.focus();
      }
      return self.clients.openWindow(path);
    })(),
  );
});
