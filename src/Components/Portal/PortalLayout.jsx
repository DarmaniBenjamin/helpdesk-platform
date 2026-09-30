import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { ChevronDown, Inbox, LogOut, Plus, User } from "lucide-react";
import Avatar from "../Avatar";
import useDismiss from "../useDismiss";
import useClosing from "../useClosing";
import { ThemeSwitchRow } from "../ThemeToggle";
import LoadingScreen from "../LoadingScreen";
import useData from "../../useData";

// The frame around every customer portal page: a simple top bar with the
// customer's requests, a "New request" button and their account menu.
// Nobody signed in: go to the login page. Staff: go to the dashboard.
export default function PortalLayout() {
  const { me, authChecked } = useData();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useDismiss(menuRef, () => setMenuOpen(false), menuOpen);
  // It stays a moment after closing, to pop back into its button
  const menuPanel = useClosing(menuOpen);

  useEffect(() => {
    document.title = "Help Center · Ticket Support";
  }, []);

  // Still checking with the server whether you're signed in
  if (!authChecked) return <LoadingScreen />;
  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (me.role !== "customer") return <Navigate to="/" replace />;

  const tabClass = ({ isActive }) =>
    `flex h-10 items-center gap-2 rounded-lg px-3 text-sm transition active:scale-[0.97] ${
      isActive
        ? "bg-brand/10 font-medium text-brand"
        : "text-muted hover:bg-brand/10 hover:text-brand"
    }`;

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link to="/portal" className="flex items-center gap-2">
            <div className="h-8 w-8 shrink-0 rounded-full bg-brand" />
            <span className="hidden font-semibold sm:inline">
              Ticket Support
            </span>
            <span className="rounded-md bg-page px-2 py-0.5 text-xs text-muted">
              Help Center
            </span>
          </Link>

          <nav className="ml-auto flex items-center gap-1">
            <NavLink to="/portal" end className={tabClass}>
              <Inbox className="h-4 w-4" />
              <span className="hidden sm:inline">My requests</span>
            </NavLink>
            <Link
              to="/portal/new"
              className="flex h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New request</span>
            </Link>

            {/* Account menu */}
            <div ref={menuRef} className="relative ml-1">
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                onClick={() => setMenuOpen((o) => !o)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg p-1.5 transition hover:bg-brand/10 active:scale-[0.97] ${
                  menuOpen ? "bg-brand/10" : ""
                }`}
              >
                <Avatar name={me.name} photo={me.photo} size="sm" />
                <ChevronDown
                  className={`hidden h-4 w-4 text-muted transition-transform sm:block ${
                    menuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {menuPanel.shown && (
                <div
                  className={`absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-line bg-white shadow-xl ${menuPanel.closing ? "animate-pop-out" : ""}`}
                >
                  <div className="border-b border-line px-4 py-3">
                    <p className="truncate text-sm font-semibold">{me.name}</p>
                    <p className="truncate text-xs text-muted">{me.email}</p>
                  </div>
                  <div className="p-2">
                    <Link
                      to="/portal/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted transition hover:bg-brand/10 hover:text-brand"
                    >
                      <User className="h-4 w-4" />
                      My profile
                    </Link>
                    <ThemeSwitchRow />
                    <hr className="my-2 border-line" />
                    <Link
                      to="/login"
                      className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-red-500 transition hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* key: each page comes in with a short fade (index.css) */}
        <div key={location.pathname} className="animate-page-in">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-line bg-white">
        <p className="mx-auto max-w-5xl px-4 py-4 text-center text-xs text-muted sm:px-6">
          Ticket Support Help Center
        </p>
      </footer>
    </div>
  );
}
