import { useEffect } from "react";

// Phones and tablets: swipe right from the left side of the screen to open
// the menu, swipe left to close it (like many phone apps). Used by
// StaffLayout.jsx.
//
// The very edge of the screen belongs to the phone: on iPhone (Safari) and
// Android a swipe that starts right at the edge is the system's Back, and
// websites can't take that over. So the swipe works from just inside the
// edge, across the left part of the screen.

const LEFT_ZONE = 0.35; // how far in from the left a swipe may start (of the width)
const DISTANCE = 60; // px the finger has to travel sideways
const PHONE_WIDTH = 1024; // the menu is a drawer below this (Tailwind lg)

// Is this swipe for the menu? start/end: { x, y }. Returns "open", "close"
// or null. Kept separate so it can be tested on its own.
export function swipeAction({ start, end, open, width }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // Mostly sideways (not someone scrolling up or down)
  if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  if (!open && dx > 0 && start.x <= width * LEFT_ZONE) return "open";
  if (open && dx < 0) return "close";
  return null;
}

// Things a sideways swipe means something else in: typing, and anything
// that scrolls sideways itself (wide tables, rows of cards). [data-no-swipe]
// marks others.
function swipeBelongsElsewhere(target) {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.matches?.("input, textarea, select, [contenteditable='true'], [data-no-swipe]")) return true;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

export default function useSwipeMenu({ open, onOpen, onClose }) {
  useEffect(() => {
    let start = null;

    const down = (e) => {
      start = null;
      if (e.touches.length !== 1 || window.innerWidth >= PHONE_WIDTH) return;
      if (swipeBelongsElsewhere(e.target)) return;
      // Selecting text: leave it alone
      if (String(window.getSelection?.() ?? "").length) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const up = (e) => {
      if (!start) return;
      const touch = e.changedTouches[0];
      const action = swipeAction({
        start,
        end: { x: touch.clientX, y: touch.clientY },
        open,
        width: window.innerWidth,
      });
      start = null;
      if (action === "open") onOpen();
      else if (action === "close") onClose();
    };
    const cancel = () => {
      start = null;
    };

    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", cancel);
    };
  }, [open, onOpen, onClose]);
}
