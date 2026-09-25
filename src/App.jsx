import { useState } from "react";
import { Routes, Route, useParams } from "react-router";
import Sidebar from "./Components/Sidebar";
import Topbar from "./Components/Topbar";
import Dashboard from "./Components/Pages/Dashboard";
import Customers from "./Components/Pages/Customers";
import ComingSoon from "./Components/Pages/ComingSoon";
import { customers as startingCustomers } from "./data";

// Placeholder for a single ticket until the ticket page is built
function TicketPlaceholder() {
  const { id } = useParams();
  return <ComingSoon title={`Ticket #${id}`} />;
}

// Placeholder for a customer's own page
function CustomerPlaceholder({ customers }) {
  const { id } = useParams();
  const customer = customers.find((c) => c.id === Number(id));
  return <ComingSoon title={customer ? customer.name : "Customer not found"} />;
}

export default function App() {
  // Is the menu open on phones/tablets?
  const [menuOpen, setMenuOpen] = useState(false);
  // Is the sidebar shrunk to icons on desktop?
  const [collapsed, setCollapsed] = useState(false);

  // Customers live here, so the Customers page and the New ticket
  // form both see the same list (and new customers show up in both)
  const [customers, setCustomers] = useState(startingCustomers);

  function addCustomer(fields) {
    const customer = {
      id: Math.max(...customers.map((c) => c.id)) + 1,
      name: fields.name.trim(),
      email: fields.email.trim().toLowerCase(),
      phone: fields.phone.trim(),
      company: fields.company.trim() || null, // empty means an individual
      createdAt: Date.now(),
    };
    setCustomers((list) => [customer, ...list]);
    return customer;
  }

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
          customers={customers}
          onAddCustomer={addCustomer}
        />
        <main className="flex-1 p-4 sm:p-6 lg:overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inbox" element={<ComingSoon title="Inbox" />} />
            <Route
              path="/customers"
              element={
                <Customers customers={customers} onAddCustomer={addCustomer} />
              }
            />
            <Route
              path="/customers/:id"
              element={<CustomerPlaceholder customers={customers} />}
            />
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
            <Route path="/tickets/:id" element={<TicketPlaceholder />} />
            <Route path="/login" element={<ComingSoon title="Login" />} />
            <Route path="*" element={<ComingSoon title="Page not found" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
