import {
  LayoutDashboard,
  Inbox,
  BookUser,
  UserCheck,
  Tag,
  Gauge,
  Zap,
  MessageSquareText,
  Users,
  Mail,
  ChartColumn,
  Settings,
} from "lucide-react";
import { can } from "./teamRoles";

// The sidebar menu. Used by the Sidebar (to draw the links)
// and the Topbar (to show the current page's name).
// `permission` = who can see the page (see PERMISSIONS in teamRoles.js).
// Links without one are open to all staff.
export const mainLinks = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Inbox", path: "/inbox", icon: Inbox },
  { label: "Customers", path: "/customers", icon: BookUser },
  {
    label: "Ticket Assignment",
    path: "/assignment",
    icon: UserCheck,
    permission: "rules",
  },
  { label: "Ticket Topics", path: "/topics", icon: Tag },
  {
    label: "Performance & Feedback",
    path: "/performance",
    icon: Gauge,
    permission: "reports",
  },
];

export const moreLinks = [
  { label: "Automation", path: "/automation", icon: Zap, permission: "rules" },
  { label: "Knowledge Base", path: "/knowledge-base", icon: MessageSquareText },
  { label: "Team", path: "/team", icon: Users, permission: "team" },
  {
    label: "Email Integration",
    path: "/email",
    icon: Mail,
    permission: "email",
  },
  {
    label: "Report and Statistics",
    path: "/reports",
    icon: ChartColumn,
    permission: "reports",
  },
  {
    label: "Settings",
    path: "/settings",
    icon: Settings,
    permission: "settings",
  },
];

// Only the links this access level is allowed to see
export function linksFor(links, role) {
  return links.filter((l) => !l.permission || can(role, l.permission));
}

// Can this access level open the page at this address?
export function canOpen(role, pathname) {
  const link = [...mainLinks, ...moreLinks].find((l) => l.path === pathname);
  return !link?.permission || can(role, link.permission);
}

// Turns a URL like "/inbox" or "/tickets/4821" into a page name
export function getPageTitle(pathname) {
  const link = [...mainLinks, ...moreLinks].find((l) => l.path === pathname);
  if (link) return link.label;
  if (pathname.startsWith("/tickets/"))
    return `Ticket #${pathname.split("/")[2]}`;
  if (pathname.startsWith("/customers/")) return "Customer";
  if (pathname === "/profile") return "My profile";
  if (pathname === "/login") return "Login";
  return "Page not found";
}
