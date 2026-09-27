// Copies text to the clipboard. Returns true if it worked.
// Phones on plain http (like testing with --host) block the clipboard,
// so the text is shown in a box to copy by hand instead.
export async function copyText(text, promptLabel = "Copy this:") {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt(promptLabel, text);
    return false;
  }
}

// The link an invited person opens to set up their account
export function inviteLinkFor(token) {
  return `${window.location.origin}/welcome/${token}`;
}
