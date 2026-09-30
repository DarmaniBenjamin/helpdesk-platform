// Turning desktop/phone notifications on and off in this browser.
// The notifications themselves are shown by public/sw.js.
import { api } from "./api";

const isIphone = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPads say they're Macs, but Macs don't have touch screens
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Opened from the Home Screen (not in a normal browser tab)?
const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

// Can this browser show notifications here? Returns null if yes, or the
// reason why not, in words
export function whyNoPush() {
  if (!window.isSecureContext) {
    return "Notifications only work on a secure address: https://…, or localhost on this computer.";
  }
  if (isIphone() && !isInstalled()) {
    return "On iPhone: tap Share, then Add to Home Screen, and open Uplink from your Home Screen.";
  }
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "This browser can't show notifications.";
  }
  return null;
}

// "on", "off" or "blocked" (said no before) for this browser
export async function pushStatus() {
  if (whyNoPush()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

// The server's public key comes as text; browsers want bytes
function keyToBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// Signs this browser up with the browser maker's push service and tells
// our server where to send notifications
async function subscribe() {
  const { publicKey } = await api("/push/key");
  if (!publicKey) {
    throw new Error(
      "The server isn't set up for notifications yet (VAPID keys are missing in server/.env).",
    );
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true, // every message shows a notification
      applicationServerKey: keyToBytes(publicKey),
    }));
  await api("/push/subscribe", { method: "POST", body: subscription.toJSON() });
}

// Must be called straight from a click: browsers only ask "Allow
// notifications?" when you've just tapped something
export async function turnOnPush() {
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new Error(
      "Notifications are blocked for this site. Allow them in the browser's site settings (the icon left of the address), then try again.",
    );
  }
  if (permission !== "granted") {
    throw new Error("Notifications weren't allowed.");
  }
  await subscribe();
}

export async function turnOffPush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api("/push/unsubscribe", {
    method: "POST",
    body: { endpoint: subscription.endpoint },
  }).catch(() => {});
  await subscription.unsubscribe();
}

// After signing in: if this browser already allowed notifications,
// make sure the server sends them to whoever is signed in now
export async function resumePush() {
  if (whyNoPush() || Notification.permission !== "granted") return;
  try {
    await subscribe();
  } catch {
    // Not important enough to bother anyone: the switch shows "off"
  }
}

// Before signing out: stop sending this account's notifications here
export async function pausePush() {
  if (whyNoPush()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api("/push/unsubscribe", {
      method: "POST",
      body: { endpoint: subscription.endpoint },
    }).catch(() => {});
  }
}
