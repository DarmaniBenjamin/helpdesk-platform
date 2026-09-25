import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router";
import {
  Menu,
  PanelLeft,
  Search,
  Bell,
  Sun,
  Plus,
  ChevronDown,
  X,
  Ticket,
  Clock,
  MessageSquare,
  User,
  Settings,
  LogOut,
} from "lucide-react";
import useDismiss from "./useDismiss";
import NewTicketModal from "./NewTicketModal";
import { getPageTitle } from "./navLinks";
import { isOverdue, timeAgo } from "../data";
import useData from "../useData";

// Notifications built from the real ticket data
function buildNotifications(tickets) {
  const list = [];

  const newest = tickets[0];
  list.push({
    id: 1,
    icon: Ticket,
    unread: true,
    ticketId: newest.id,
    title: `New ticket #${newest.id}`,
    text: `${newest.requester.name}: ${newest.subject}`,
    time: timeAgo(newest.createdAt),
  });

  const overdue = tickets.find(isOverdue);
  if (overdue) {
    list.push({
      id: 2,
      icon: Clock,
      unread: true,
      ticketId: overdue.id,
      title: "SLA warning",
      text: `Ticket #${overdue.id} is overdue`,
      time: timeAgo(overdue.dueBy),
    });
  }

  const waiting = tickets.find((t) => t.status === "waiting");
  if (waiting) {
    list.push({
      id: 3,
      icon: MessageSquare,
      unread: false,
      ticketId: waiting.id,
      title: "Waiting on customer",
      text: `${waiting.requester.name} hasn't replied on #${waiting.id}`,
      time: timeAgo(waiting.updatedAt),
    });
  }

  return list;
}

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
  const { tickets } = useData();

  // The current page's name, from the URL
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  // Also show it in the browser tab
  useEffect(() => {
    document.title = `${pageTitle} · Ticket Support`;
  }, [pageTitle]);

  // Mobile search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Dropdowns and the new ticket form
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [notifications, setNotifications] = useState(() =>
    buildNotifications(tickets),
  );

  const notifRef = useRef(null);
  const userRef = useRef(null);
  useDismiss(notifRef, () => setNotifOpen(false), notifOpen);
  useDismiss(userRef, () => setUserOpen(false), userOpen);

  const unreadCount = notifications.filter((n) => n.unread).length;

  function handleSearch(e) {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;
    navigate(`/inbox?search=${encodeURIComponent(text)}`);
    setSearchOpen(false);
  }

  function openNotification(n) {
    setNotifications((list) =>
      list.map((item) =>
        item.id === n.id ? { ...item, unread: false } : item,
      ),
    );
    setNotifOpen(false);
    navigate(`/tickets/${n.ticketId}`);
  }

  function markAllRead() {
    setNotifications((list) =>
      list.map((item) => ({ ...item, unread: false })),
    );
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-white px-3 sm:gap-4 sm:px-6">
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
          {notifOpen && (
            <div className={`${panelClass} sm:w-80`}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-sm font-semibold">Notifications</p>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="cursor-pointer text-xs font-medium text-brand hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
                >
                  Mark all as read
                </button>
              </div>
              <ul className="max-h-80 overflow-y-auto p-2">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2.5 text-left transition hover:bg-brand/5 active:scale-[0.99]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                        <n.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {n.title}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {n.text}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted/70">
                          {n.time}
                        </span>
                      </span>
                      {n.unread && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <IconButton
          icon={Sun}
          label="Toggle theme"
          iconEffect="group-hover:rotate-90"
          className="hidden sm:block"
        />

        <button
          type="button"
          onClick={() => setNewTicketOpen(true)}
          className="group flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand/30 active:translate-y-0 active:scale-[0.97] sm:px-4"
        >
          <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
          <span className="hidden sm:inline">Add Ticket</span>
        </button>

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
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-medium text-white ring-2 ring-transparent transition group-hover:ring-brand/40">
              DB
            </div>
            <span className="hidden text-sm font-medium lg:block">
              Darmani Benjamin
            </span>
            <ChevronDown
              className={`hidden h-4 w-4 text-muted transition-transform duration-200 sm:block ${
                userOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {userOpen && (
            <div className={`${panelClass} sm:w-56`}>
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold">Darmani Benjamin</p>
                <p className="text-xs text-muted">Admin</p>
              </div>
              <div className="p-2">
                {[
                  { label: "My profile", icon: User, to: "/settings" },
                  { label: "Settings", icon: Settings, to: "/settings" },
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
