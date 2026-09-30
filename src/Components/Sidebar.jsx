import { useEffect, useRef, useState } from "react";
import { NavLink, Link } from "react-router";
import { ChevronsUpDown, X, User, Settings, LogOut } from "lucide-react";
import Avatar from "./Avatar";
import useDismiss from "./useDismiss";
import useClosing from "./useClosing";
import { mainLinks, moreLinks, linksFor } from "./navLinks";
import { ROLES, can } from "./teamRoles";
import useData from "../useData";

function SidebarLink({ link, onClick, collapsed }) {
  const Icon = link.icon;

  return (
    <li>
      <NavLink
        to={link.path}
        end={link.path === "/"}
        onClick={onClick}
        title={collapsed ? link.label : undefined}
        className={({ isActive }) =>
          `group relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-all duration-200 active:scale-[0.97] ${
            collapsed ? "lg:justify-center" : ""
          } ${
            isActive
              ? "bg-brand/10 font-medium text-brand"
              : "text-muted hover:bg-brand/10 hover:text-brand"
          }`
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-all duration-300 ${
                isActive ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"
              }`}
            />
            <Icon
              className={`h-4 w-4 transition-transform duration-200 ${
                isActive ? "scale-110" : "group-hover:scale-110"
              }`}
            />
            <span
              className={`whitespace-nowrap transition-transform duration-200 group-hover:translate-x-0.5 ${
                collapsed ? "lg:hidden" : ""
              }`}
            >
              {link.label}
            </span>
          </>
        )}
      </NavLink>
    </li>
  );
}

// The box at the bottom of the sidebar. Clicking it opens an account menu
// above it: who you are, and links to your profile and settings.
function AccountMenu({ collapsed, onNavigate }) {
  const { me } = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useDismiss(menuRef, () => setMenuOpen(false), menuOpen);
  // It pops up out of the button, and back into it when closing
  const panel = useClosing(menuOpen);

  // Close the menu and (on phones) the sidebar after picking a link
  function go() {
    setMenuOpen(false);
    onNavigate();
  }

  const links = [
    { label: "My profile", icon: User, to: "/profile" },
    // Settings is for the Super Admin only
    ...(can(me.role, "settings")
      ? [{ label: "Settings", icon: Settings, to: "/settings" }]
      : []),
  ];

  return (
    <div ref={menuRef} className="relative border-t border-line p-3">
      {panel.shown && (
        <div
          className={`absolute bottom-full left-3 z-50 mb-2 w-64 rounded-xl border border-line bg-white shadow-xl ${
            panel.closing ? "animate-pop-out-down" : "animate-pop-in-up"
          }`}
        >
          {/* Who you are */}
          <Link
            to="/profile"
            onClick={go}
            className="flex items-center gap-3 rounded-t-xl border-b border-line p-4 transition hover:bg-brand/5"
          >
            <Avatar name={me.name} photo={me.photo} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{me.name}</p>
              <p className="truncate text-xs text-muted">{me.email}</p>
              <p className="text-xs text-muted">{ROLES[me.role].label}</p>
            </div>
          </Link>

          <div className="p-2">
            {links.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.label}
                  to={link.to}
                  onClick={go}
                  className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted transition hover:bg-brand/10 hover:text-brand"
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
            <hr className="my-2 border-line" />
            <Link
              to="/login"
              onClick={go}
              className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-red-500 transition hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Link>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-expanded={menuOpen}
        aria-label="Account menu"
        onClick={() => setMenuOpen((o) => !o)}
        title={collapsed ? me.name : undefined}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition hover:bg-brand/10 active:scale-[0.98] ${
          menuOpen ? "bg-brand/10" : ""
        } ${collapsed ? "lg:justify-center" : ""}`}
      >
        <Avatar name={me.name} photo={me.photo} />
        <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
          <p className="truncate text-sm font-semibold">{me.name}</p>
          <p className="truncate text-xs text-muted">{ROLES[me.role].label}</p>
        </div>
        <ChevronsUpDown
          className={`h-4 w-4 shrink-0 text-muted ${collapsed ? "lg:hidden" : ""}`}
        />
      </button>
    </div>
  );
}

export default function Sidebar({ open, onClose, collapsed }) {
  const { me } = useData();
  // Close the menu when Escape is pressed
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      {/* Dark background behind the open menu (phones/tablets only) */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-70 flex-col border-r border-line bg-white transition-all duration-300 lg:relative lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-20" : "lg:w-70"}`}
      >
        <div
          className={`flex h-16 items-center gap-2 px-5 ${collapsed ? "lg:px-6" : ""}`}
        >
          <div className="h-8 w-8 shrink-0 rounded-full bg-brand"></div>
          <span
            className={`whitespace-nowrap text-lg font-semibold ${collapsed ? "lg:hidden" : ""}`}
          >
            DeskFlow
          </span>
          <button
            aria-label="Close menu"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          className={`flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 ${collapsed ? "lg:px-3" : ""}`}
        >
          <ul className="flex flex-col gap-1">
            {/* Only the pages this person is allowed to open */}
            {linksFor(mainLinks, me.role).map((link) => (
              <SidebarLink
                key={link.path}
                link={link}
                onClick={onClose}
                collapsed={collapsed}
              />
            ))}
          </ul>

          <hr className="my-4 border-line" />

          <ul className="flex flex-col gap-1">
            {linksFor(moreLinks, me.role).map((link) => (
              <SidebarLink
                key={link.path}
                link={link}
                onClick={onClose}
                collapsed={collapsed}
              />
            ))}
          </ul>
        </nav>

        <AccountMenu collapsed={collapsed} onNavigate={onClose} />
      </aside>
    </>
  );
}
