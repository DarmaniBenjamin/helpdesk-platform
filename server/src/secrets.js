// Locks and unlocks secrets kept in the database: mailbox passwords and
// the sign-in tokens for Microsoft and Google mailboxes, and the
// "Client secret" of the Microsoft and Google sign-in apps.
//
// They're encrypted (AES-256-GCM) with a key that's made the first time
// it's needed and kept in a file on this server, never in the database:
// server/.secret-key (or wherever SECRET_KEY_FILE in server/.env says).
// So a copy of the database, or a downloaded backup, doesn't give anyone
// the mailbox passwords.
//
// Moving to another server: the new server makes its own key, so the
// mailboxes from a restored backup show "Sign in again" until each one
// is reconnected (one click for Microsoft/Google). To skip that, copy
// the .secret-key file over too, before starting the new server.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KEY_FILE = path.resolve(process.env.SECRET_KEY_FILE || ".secret-key");

let key = null;
function getKey() {
  if (key) return key;
  try {
    key = Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error(`${KEY_FILE} isn't a valid key.`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    key = crypto.randomBytes(32);
    // Readable by this server's user only
    fs.writeFileSync(KEY_FILE, key.toString("base64"), { mode: 0o600 });
  }
  return key;
}

// Thrown when something can't be unlocked, e.g. it was locked by
// another server's key (a backup restored on a new server)
export class LockedSecret extends Error {}

// "hunter2" → "v1:…" (different every time, even for the same text)
export function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

// "v1:…" → "hunter2"
export function unseal(sealed) {
  try {
    if (!String(sealed).startsWith("v1:")) throw new Error();
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getKey(),
      raw.subarray(0, 12),
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new LockedSecret("This was saved on another server. Sign in again.");
  }
}
