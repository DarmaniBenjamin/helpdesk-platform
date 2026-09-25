import { useState } from "react";
import { Routes, Route } from "react-router";
import Sidebar from "./Components/Sidebar";
import Topbar from "./Components/Topbar";
import Dashboard from "./Components/Pages/Dashboard";
import ComingSoon from "./Components/Pages/ComingSoon";

export default function App() {
  // Is the menu open on phones/tablets?
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-page">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inbox" element={<ComingSoon title="Inbox" />} />
            <Route
              path="/assignment"
              element={<ComingSoon title="Ticket Assignment" />}
            />
            <Route
              path="/topics"
              element={<ComingSoon title="Ticket Topics" />}
            />
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
            <Route path="*" element={<ComingSoon title="Page not found" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
