import { useState } from "react";
import { Routes, Route } from "react-router";
import Sidebar from "./Components/Sidebar";
import Topbar from "./Components/Topbar";
import Dashboard from "./Components/Pages/Dashboard";
import Inbox from "./Components/Pages/Inbox";
import Customers from "./Components/Pages/Customers";
import TicketDetail from "./Components/Pages/TicketDetail";
import CustomerDetail from "./Components/Pages/CustomerDetail";
import TicketTopics from "./Components/Pages/TicketTopics";
import ComingSoon from "./Components/Pages/ComingSoon";
import ScrollToTop from "./Components/ScrollToTop";

export default function App() {
  // Is the menu open on phones/tablets?
  const [menuOpen, setMenuOpen] = useState(false);
  // Is the sidebar shrunk to icons on desktop?
  const [collapsed, setCollapsed] = useState(false);

  return (
    // Phones/tablets: the whole page scrolls (so the browser bars can hide).
    // Desktop (lg): fixed height, only the content area scrolls.
    <div className="flex min-h-dvh bg-page lg:h-screen">
      <ScrollToTop />
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
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route
              path="/assignment"
              element={<ComingSoon title="Ticket Assignment" />}
            />
            <Route path="/topics" element={<TicketTopics />} />
            <Route
              path="/sla"
              element={<ComingSoon title="SLA Management" />}
            />
            <Route
              path="/statuses"
              element={<ComingSoon title="Custom Ticket Status" />}
            />
            <Route
              path="/automation"
              element={<ComingSoon title="Automation" />}
            />
            <Route
              path="/saved-answers"
              element={<ComingSoon title="Saved Answers" />}
            />
            <Route path="/team" element={<ComingSoon title="Team work" />} />
            <Route
              path="/joint-editing"
              element={<ComingSoon title="Joint Editing" />}
            />
            <Route
              path="/email"
              element={<ComingSoon title="Email Integration" />}
            />
            <Route
              path="/reports"
              element={<ComingSoon title="Report and Statistics" />}
            />
            <Route path="/settings" element={<ComingSoon title="Settings" />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/login" element={<ComingSoon title="Login" />} />
            <Route path="*" element={<ComingSoon title="Page not found" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
