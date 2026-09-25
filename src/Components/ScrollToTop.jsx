import { useLayoutEffect } from "react";
import { useLocation } from "react-router";

// Every time you go to a different page, start at the top of it.
// (Only when the page itself changes, so typing in a search box
// that updates the URL doesn't make you jump.)
export default function ScrollToTop() {
  const { pathname } = useLocation();

  // useLayoutEffect runs before the browser paints the new page,
  // so you never see it flash at the old scroll position
  useLayoutEffect(() => {
    window.scrollTo(0, 0); // phones and tablets: the whole page scrolls
    document.querySelector("main")?.scrollTo(0, 0); // desktop: only the content area scrolls
  }, [pathname]);

  return null; // draws nothing on the screen
}
