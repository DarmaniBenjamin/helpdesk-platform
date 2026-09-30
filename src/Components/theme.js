// Light and dark mode.
//
// Your choice is kept in the browser. Until you pick one, the app follows
// your phone or computer's own setting. The "dark" class on <html> switches
// the colours; index.css has the dark colours, and index.html sets the class
// before the page shows so it never flashes white.
//
// Switching: the browser takes a picture of the page, switches every
// colour at once, and fades smoothly from the picture to the new look
// ("view transition"). The whole page changes together, so text never
// lags behind the backgrounds, even on slower phones. Browsers that can't
// do this (and anyone with "reduce motion" on) switch instantly instead.
import { useSyncExternalStore } from "react";

const KEY = "helpdesk-theme";
const listeners = new Set();
const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

// "dark" or "light"
export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // storage blocked: fall back to the system setting
  }
  return systemQuery().matches ? "dark" : "light";
}

// Switches the colours. `then` runs at the same moment (it updates the
// sun/moon button), so the button is already right in the new look.
function apply(theme, animate, then) {
  function change() {
    document.documentElement.classList.toggle("dark", theme === "dark");
    // The colour of the browser bar on phones
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0f141a" : "#ffffff");
    then?.();
  }

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (animate && document.startViewTransition && !reduceMotion) {
    document.startViewTransition(change);
  } else {
    change();
  }
}

const tellListeners = () => listeners.forEach((listener) => listener());

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: it just won't be remembered
  }
  apply(theme, true, tellListeners);
}

function subscribe(listener) {
  listeners.add(listener);
  // If you haven't picked one, follow the system setting when it changes
  const query = systemQuery();
  const onSystemChange = () => apply(getTheme(), true, listener);
  query.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(listener);
    query.removeEventListener("change", onSystemChange);
  };
}

// const [theme, toggleTheme] = useTheme()
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")];
}
