import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import NoAccess from "./Pages/NoAccess";
import { canOpen } from "./navLinks";
import useData from "../useData";

// The frame around every staff page: sidebar, top bar, and the page itself.
// Nobody signed in: go to the login page. A customer: go to their portal.
export default function StaffLayout() {
  const { me } = useData();
  const location = useLocation();
  // Is the menu open on phones/tablets?
  const [menuOpen, setMenuOpen] = useState(false);
  // Is the sidebar shrunk to icons on desktop?
  const [collapsed, setCollapsed] = useState(false);

  if (!me) {
    // Remember where they were going, to send them back after signing in
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (me.role === "customer") return <Navigate to="/portal" replace />;

  return (
    // Phones/tablets: the whole page scrolls (so the browser bars can hide).
    // Desktop (lg): fixed height, only the content area scrolls.
    <div className="flex min-h-dvh bg-page lg:h-screen">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collapsed={collapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
        <Topbar
          onMenuClick={() => setMenuOpen(true)}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        <main className="flex-1 p-4 sm:p-6 lg:overflow-y-auto">
          {/* Pages this person isn't allowed to open show a message instead */}
          {canOpen(me.role, location.pathname) ? <Outlet /> : <NoAccess />}
        </main>
      </div>
    </div>
  );
}
