import { useEffect } from "react";
import { NavLink } from "react-router";
import {
  LayoutDashboard,
  Inbox,
  UserCheck,
  Tag,
  Clock,
  Box,
  Zap,
  MessageSquareText,
  Users,
  GitMerge,
  Mail,
  ChartColumn,
  Settings,
  ChevronRight,
  X,
} from "lucide-react";

const mainLinks = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Inbox", path: "/inbox", icon: Inbox },
  { label: "Ticket Assignment", path: "/assignment", icon: UserCheck },
  { label: "Ticket Topics", path: "/topics", icon: Tag },
  { label: "SLA Management", path: "/sla", icon: Clock },
];

const moreLinks = [
  { label: "Custom Ticket Status", path: "/statuses", icon: Box },
  { label: "Automation", path: "/automation", icon: Zap },
  { label: "Saved Answers", path: "/saved-answers", icon: MessageSquareText },
  { label: "Team work", path: "/team", icon: Users },
  { label: "Joint Editing", path: "/joint-editing", icon: GitMerge },
  { label: "Email Integration", path: "/email", icon: Mail },
  { label: "Report and Statistics", path: "/reports", icon: ChartColumn },
  { label: "Settings", path: "/settings", icon: Settings },
];

function SidebarLink({ link, onClick }) {
  const Icon = link.icon;

  return (
    <li>
      <NavLink
        to={link.path}
        end={link.path === "/"}
        onClick={onClick}
        className={({ isActive }) =>
          `group relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-all duration-200 active:scale-[0.97] ${
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
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">
              {link.label}
            </span>
          </>
        )}
      </NavLink>
    </li>
  );
}

export default function Sidebar({ open, onClose }) {
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
        className={`fixed inset-y-0 left-0 z-50 flex w-70 flex-col border-r border-line bg-white transition-transform duration-300 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 px-5">
          <div className="h-8 w-8 rounded-full bg-brand"></div>
          <span className="text-lg font-semibold">Ticket Support</span>
          <button
            aria-label="Close menu"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-6 py-4">
          <ul className="flex flex-col gap-1">
            {mainLinks.map((link) => (
              <SidebarLink key={link.path} link={link} onClick={onClose} />
            ))}
          </ul>

          <hr className="my-4 border-line" />

          <ul className="flex flex-col gap-1">
            {moreLinks.map((link) => (
              <SidebarLink key={link.path} link={link} onClick={onClose} />
            ))}
          </ul>
        </nav>

        <div className="border-t border-line p-3">
          <button className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left hover:bg-brand/10">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-medium text-white">
              SA
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted">Welcome back 👋</p>
              <p className="text-sm font-semibold">SM Ashik</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted" />
          </button>
        </div>
      </aside>
    </>
  );
}
