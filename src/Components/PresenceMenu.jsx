import { useRef, useState } from "react";
import { useLocation } from "react-router";
import { Eye } from "lucide-react";
import Avatar from "./Avatar";
import useDismiss from "./useDismiss";
import { getViewers } from "./presence";
import { getPageTitle } from "./navLinks";
import { ROLES } from "./teamRoles";
import useData from "../useData";

// The eye button in the top bar. Hover it (or tap it on a phone) to see who
// else is on the same page, e.g. two agents looking at the same ticket.
export default function PresenceMenu() {
  const { team, me } = useData();
  const { pathname } = useLocation();
  const viewers = getViewers(team, pathname, me.id);

  // Remember which page it was opened on, so it closes by itself
  // when you move to another page
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === pathname;

  const wrapRef = useRef(null);
  useDismiss(wrapRef, () => setOpenOn(null), open);

  // Mouse: open on hover. Touch: open and close with a tap.
  const lastPointer = useRef("mouse");
  function handleEnter(e) {
    if (e.pointerType === "mouse") setOpenOn(pathname);
  }
  function handleLeave(e) {
    if (e.pointerType === "mouse") setOpenOn(null);
  }
  function handleClick() {
    if (lastPointer.current === "mouse") setOpenOn(pathname);
    else setOpenOn(open ? null : pathname);
  }

  const count = viewers.length;

  return (
    <div
      ref={wrapRef}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      className="sm:relative"
    >
      <button
        type="button"
        aria-label={`Who's viewing this page (${count} other${count === 1 ? "" : "s"})`}
        aria-expanded={open}
        onPointerDown={(e) => (lastPointer.current = e.pointerType)}
        onClick={handleClick}
        className={`group relative cursor-pointer rounded-lg p-2.5 transition hover:bg-brand/10 hover:text-brand active:scale-[0.92] sm:p-2 ${
          open ? "bg-brand/10 text-brand" : "text-muted"
        }`}
      >
        <Eye className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white ring-2 ring-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        // The outer box has padding instead of a margin on top, so the mouse
        // can move from the button to the panel without it closing
        <div className="fixed left-3 right-3 top-16 z-30 pt-2 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-72">
          <div className="rounded-xl border border-line bg-white shadow-xl">
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">Viewing this page</p>
              <p className="truncate text-xs text-muted">
                {getPageTitle(pathname)}
              </p>
            </div>

            <ul className="max-h-72 overflow-y-auto p-2">
              <li className="flex items-center gap-3 rounded-lg p-2">
                <Avatar name={me.name} photo={me.photo} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {me.name}
                  </span>
                  <span className="block text-xs text-muted">You</span>
                </span>
              </li>
              {viewers.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-brand/5"
                >
                  <Avatar name={m.name} photo={m.photo} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {ROLES[m.role].label} · here for {m.minutes} min
                    </span>
                  </span>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                </li>
              ))}
            </ul>

            {count === 0 && (
              <p className="border-t border-line px-4 py-3 text-xs text-muted">
                Nobody else is on this page right now.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
