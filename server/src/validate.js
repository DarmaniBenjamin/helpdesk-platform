// Small checks for what the front end sends. Each returns the cleaned-up
// value, or throws a BadInput error that becomes a 400 with the message.

export class BadInput extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function cleanText(value, { label, max = 100, required = false }) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new BadInput(`${label} can't be empty.`);
  if (text.length > max)
    throw new BadInput(`${label} can be at most ${max} characters.`);
  return text;
}

export function cleanEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  // Something@something.something, no spaces
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    throw new BadInput("Enter a valid email address.");
  return email;
}

export function cleanPassword(value) {
  const password = String(value ?? "");
  if (password.length < 8)
    throw new BadInput("The password needs at least 8 characters.");
  if (password.length > 200) throw new BadInput("That password is too long.");
  return password;
}

// A profile photo: a small image as a data URL (the app shrinks photos
// to 256×256 before sending them), or null to remove it
export function cleanPhoto(value) {
  if (value === null) return null;
  const photo = String(value ?? "");
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo))
    throw new BadInput("That photo isn't a supported image.");
  if (photo.length > 400_000)
    throw new BadInput("That photo is too big. Pick a smaller one.");
  return photo;
}

// Turns a BadInput into a proper answer; anything else goes to the
// server's general error handler
export function handleBadInput(err, req, res, next) {
  if (err instanceof BadInput)
    return res.status(err.status).json({ error: err.message });
  next(err);
}
