import { useEffect, useState } from "react";

// Keeps a drop-down menu on screen for a moment after it's told to close,
// so it can play its closing animation (index.css) instead of vanishing.
//   open     is it meant to be open?
//   returns  { shown, closing }: draw it while `shown`; while `closing`,
//            give it the "animate-pop-out" class
// The time matches the pop-out animation in index.css.
export default function useClosing(open, ms = 120) {
  // Whether it was open last time we looked, so we notice it closing
  const [wasOpen, setWasOpen] = useState(open);
  // Still showing, playing the closing animation
  const [closing, setClosing] = useState(false);

  // Adjusting state straight away when `open` changes (React's
  // recommended way; no extra flicker)
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open);
  }

  // Once the animation has had time to play, take it off the screen
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), ms);
    return () => clearTimeout(timer);
  }, [closing, ms]);

  return { shown: open || closing, closing };
}
