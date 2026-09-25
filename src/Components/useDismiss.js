import { useEffect } from "react";

// Calls onClose when you click/tap outside `ref`, or press Escape.
// Used for dropdowns so they close like they do in real apps.
export default function useDismiss(ref, onClose, active) {
  useEffect(() => {
    if (!active) return;

    function handlePointer(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, onClose, active]);
}