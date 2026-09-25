import { useState } from "react";
import Sidebar from "./Components/Sidebar";
import Topbar from "./Components/Topbar";
import Dashboard from "./Components/Pages/Dashboard";

export default function App() {
  // Is the menu open on phones/tablets?
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-page">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Dashboard />
        </main>
      </div>
    </div>
  );
}
