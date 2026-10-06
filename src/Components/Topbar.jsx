import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router";
import {
  Menu,
  PanelLeft,
  Search,
  Bell,
  Plus,
  ChevronDown,
  X,
  Ticket,
  Clock,
  MessageSquare,
  UserCheck,
  TriangleAlert,
  User,
  Settings,
  LogOut,
  CalendarDays,
  AlarmClock,
} from "lucide-react";
import useDismiss from "./useDismiss";
import useClosing from "./useClosing";
import Avatar from "./Avatar";
import PresenceMenu from "./PresenceMenu";
import PushToggle from "./PushToggle";
import { ThemeToggleButton, ThemeSwitchRow } from "./ThemeToggle";
import { ROLES, can } from "./teamRoles";
import NewTicketModal from "./NewTicketModal";
import { getPageTitle } from "./navLinks";
import { APP_NAME } from "../brand";
import { timeAgo } from "../data";
import useData from "../useData";

// The icon for each kind of notification (see server/src/notify.js)
const NOTIFICATION_ICONS = {
  newTicket: Ticket,
  assigned: UserCheck,
  customerReply: MessageSquare,
  dueSoon: Clock,
  overdue: TriangleAlert,
  job: CalendarDays,
  jobNow: AlarmClock,
};

function IconButton({
  icon,
  label,
  dot,
  iconEffect = "",
  onClick,
  className = "",
  active = false,
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={active}
      onClick={onClick}
      className={`group relative cursor-pointer rounded-lg p-2.5 transition hover:bg-brand/10 hover:text-brand active:scale-[0.92] sm:p-2 ${
        active ? "bg-brand/10 text-brand" : "text-muted"
      } ${className}`}
    >
      <Icon
        className={`h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${iconEffect}`}
      />
      {dot && (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
      )}
    </button>
  );
}

// The panel style shared by both dropdowns: full width under the bar on
// phones, a normal dropdown under the button from 640px up.
const panelClass =
  "fixed left-3 right-3 top-18 z-30 rounded-xl border border-line bg-white shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2";

export default function Topbar({ onMenuClick, onToggleSidebar }) {
  const navigate = useNavigate();
  const { me, notifications, markNotificationRead, markAllNotificationsRead } =
    useData();

  // The current page's name, from the URL
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  // Also show it in the browser tab
  useEffect(() => {
    document.title = `${pageTitle} · ${APP_NAME}`;
  }, [pageTitle]);

  // Mobile search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Dropdowns and the new ticket form
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  const notifRef = useRef(null);
  const userRef = useRef(null);
  useDismiss(notifRef, () => setNotifOpen(false), notifOpen);
  useDismiss(userRef, () => setUserOpen(false), userOpen);
  // They stay a moment after closing, to pop back into their button
  const notifPanel = useClosing(notifOpen);
  const userPanel = useClosing(userOpen);

  const unreadCount = notifications.filter((n) => !n.read).length;

  function handleSearch(e) {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;
    navigate(`/inbox?search=${encodeURIComponent(text)}`);
    setSearchOpen(false);
  }

  function openNotification(n) {
    if (!n.read) markNotificationRead(n.id);
    setNotifOpen(false);
    // Jobs open the calendar (where you see when); the rest their ticket
    if (n.kind === "job" || n.kind === "jobNow") navigate("/calendar");
    else if (n.ticketId) navigate(`/tickets/${n.ticketId}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-white px-3 sm:gap-4 sm:px-6">
      {/* Blurred background behind the open notifications or profile menu
          (phones and tablets, like the side menu). Tapping it closes them. */}
      {(notifPanel.shown || userPanel.shown) && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-10 bg-ink/40 backdrop-blur-sm lg:hidden ${
            notifPanel.closing || userPanel.closing
              ? "animate-fade-out"
              : "animate-fade-in"
          }`}
        />
      )}
      <div className="flex min-w-0 items-center gap-1 sm:gap-4">
        <IconButton
          icon={Menu}
          label="Open menu"
          onClick={onMenuClick}
          className="lg:hidden"
        />
        <IconButton
          icon={PanelLeft}
          label="Collapse sidebar"
          onClick={onToggleSidebar}
          className="hidden lg:block"
        />

        <div className="hidden items-center gap-3 text-sm text-muted sm:flex">
          <span className="whitespace-nowrap">{pageTitle}</span>
          <span className="text-muted/50">/</span>
        </div>

        <form onSubmit={handleSearch} className="relative ml-2 hidden md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            className="h-10 w-48 rounded-lg border border-line bg-page pl-9 pr-12 text-sm transition-all duration-300 placeholder:text-muted focus:w-64 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 lg:w-64 lg:focus:w-80"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line bg-white px-1.5 text-xs text-muted">
            ⌘K
          </kbd>
        </form>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-3">
        <IconButton
          icon={Search}
          label="Search"
          onClick={() => setSearchOpen(true)}
          className="md:hidden"
        />

        {/* Notifications */}
        <div ref={notifRef} className="sm:relative">
          <IconButton
            icon={Bell}
            label="Notifications"
            dot={unreadCount > 0}
            active={notifOpen}
            iconEffect="group-hover:rotate-12"
            onClick={() => setNotifOpen((o) => !o)}
          />
          {notifPanel.shown && (
            <div
              className={`${panelClass} sm:w-80 ${notifPanel.closing ? "animate-pop-out" : ""}`}
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-sm font-semibold">Notifications</p>
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  disabled={unreadCount === 0}
                  className="cursor-pointer text-xs font-medium text-brand hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
                >
                  Mark all as read
                </button>
              </div>
              <ul className="max-h-80 overflow-y-auto p-2">
                {notifications.length === 0 && (
                  <li className="px-2.5 py-6 text-center text-sm text-muted">
                    No notifications yet
                  </li>
                )}
                {notifications.map((n) => {
                  const Icon = NOTIFICATION_ICONS[n.kind] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(n)}
                        className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2.5 text-left transition hover:bg-brand/5 active:scale-[0.99]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {n.title}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {n.body}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted/70">
                            {timeAgo(n.at)}
                          </span>
                        </span>
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <PushToggle />
            </div>
          )}
        </div>

        {/* Phones: this lives in the menu under your picture instead */}
        <ThemeToggleButton className="hidden sm:block" />

        {/* Only Admins and the Super Admin create tickets */}
        {can(me.role, "createTickets") && (
          <button
            type="button"
            onClick={() => setNewTicketOpen(true)}
            className="group flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand/30 active:translate-y-0 active:scale-[0.97] sm:px-4"
          >
            <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
            <span className="hidden sm:inline">Add Ticket</span>
          </button>
        )}

        {/* Who else is on this page */}
        <PresenceMenu />

        {/* User menu */}
        <div ref={userRef} className="sm:relative">
          <button
            type="button"
            aria-expanded={userOpen}
            onClick={() => setUserOpen((o) => !o)}
            className={`group flex cursor-pointer items-center gap-2 rounded-lg p-1.5 transition hover:bg-brand/10 active:scale-[0.97] ${
              userOpen ? "bg-brand/10" : ""
            }`}
          >
            <span className="flex rounded-full ring-2 ring-transparent transition group-hover:ring-brand/40">
              <Avatar name={me.name} photo={me.photo} size="sm" />
            </span>
            <span className="hidden max-w-40 truncate text-sm font-medium lg:block">
              {me.name}
            </span>
            <ChevronDown
              className={`hidden h-4 w-4 text-muted transition-transform duration-200 sm:block ${
                userOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {userPanel.shown && (
            <div
              className={`${panelClass} sm:w-56 ${userPanel.closing ? "animate-pop-out" : ""}`}
            >
              <div className="border-b border-line px-4 py-3">
                <p className="truncate text-sm font-semibold">{me.name}</p>
                <p className="truncate text-xs text-muted">{me.email}</p>
                <p className="text-xs text-muted">{ROLES[me.role].label}</p>
              </div>
              <div className="p-2">
                {[
                  { label: "My profile", icon: User, to: "/profile" },
                  // Settings is for the Super Admin only
                  ...(can(me.role, "settings")
                    ? [{ label: "Settings", icon: Settings, to: "/settings" }]
                    : []),
                ].map((item) => (
                  <Link
                    key={item.label}
                    to={item.to}
                    onClick={() => setUserOpen(false)}
                    className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted transition hover:bg-brand/10 hover:text-brand"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
                <ThemeSwitchRow />
                <hr className="my-2 border-line" />
                <Link
                  to="/login"
                  onClick={() => setUserOpen(false)}
                  className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-red-500 transition hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phones: search bar that covers the whole top bar when opened */}
      {searchOpen && (
        <form
          onSubmit={handleSearch}
          className="absolute inset-0 z-10 flex items-center gap-2 bg-white px-3 md:hidden"
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search tickets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              enterKeyHint="search"
              autoComplete="off"
              onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
              className="h-10 w-full rounded-lg border border-brand bg-white pl-9 pr-3 text-base placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <IconButton
            icon={X}
            label="Close search"
            onClick={() => setSearchOpen(false)}
          />
        </form>
      )}

      {/* Only drawn while open, so the form starts fresh each time */}
      {newTicketOpen && (
        <NewTicketModal onClose={() => setNewTicketOpen(false)} />
      )}
    </header>
  );
}
