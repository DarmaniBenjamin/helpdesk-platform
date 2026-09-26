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

// The sidebar menu. Used by the Sidebar (to draw the links)
// and the Topbar (to show the current page's name).
export const mainLinks = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Inbox", path: "/inbox", icon: Inbox },
  { label: "Customers", path: "/customers", icon: BookUser },
  { label: "Ticket Assignment", path: "/assignment", icon: UserCheck },
  { label: "Ticket Topics", path: "/topics", icon: Tag },
  { label: "Performance & Feedback", path: "/performance", icon: Gauge },
];

export const moreLinks = [
  { label: "Automation", path: "/automation", icon: Zap },
  { label: "Knowledge Base", path: "/knowledge-base", icon: MessageSquareText },
  { label: "Team", path: "/team", icon: Users },
  { label: "Email Integration", path: "/email", icon: Mail },
  { label: "Report and Statistics", path: "/reports", icon: ChartColumn },
  { label: "Settings", path: "/settings", icon: Settings },
];

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
