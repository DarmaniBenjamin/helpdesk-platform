// Copies text to the clipboard. Returns true if it worked.
//
// The modern way (navigator.clipboard) only works on secure addresses:
// https://, or localhost. When you open the app from another device on
// your network (e.g. http://192.168.10.213:5173) it isn't there at all,
// so the older way is used instead: put the text in a hidden box, select
// it, and "copy". If even that's blocked, the text is shown in a box to
// copy by hand.
export async function copyText(text, promptLabel = "Copy this:") {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked: try the older way below
    }
  }

  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  // Off screen, and big enough text that phones don't zoom in
  box.style.cssText = "position:fixed;top:0;left:-9999px;font-size:16px;";
  document.body.appendChild(box);
  box.select();
  box.setSelectionRange(0, text.length); // iPhones need this too
  let copied;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  box.remove();
  if (copied) return true;

  window.prompt(promptLabel, text);
  return false;
}

// The link an invited person opens to set up their account
export function inviteLinkFor(token) {
  return `${window.location.origin}/welcome/${token}`;
}
