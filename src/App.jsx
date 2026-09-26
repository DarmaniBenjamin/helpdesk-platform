import { Routes, Route } from "react-router";
import StaffLayout from "./Components/StaffLayout";
import PortalLayout from "./Components/Portal/PortalLayout";
import Dashboard from "./Components/Pages/Dashboard";
import Inbox from "./Components/Pages/Inbox";
import Customers from "./Components/Pages/Customers";
import TicketDetail from "./Components/Pages/TicketDetail";
import CustomerDetail from "./Components/Pages/CustomerDetail";
import TicketTopics from "./Components/Pages/TicketTopics";
import TicketAssignment from "./Components/Pages/TicketAssignment";
import Automation from "./Components/Pages/Automation";
import KnowledgeBase from "./Components/Pages/KnowledgeBase";
import Reports from "./Components/Pages/Reports";
import Performance from "./Components/Pages/Performance";
import Team from "./Components/Pages/Team";
import Profile from "./Components/Pages/Profile";
import Settings from "./Components/Pages/Settings";
import Login from "./Components/Pages/Login";
import AcceptInvite from "./Components/Pages/AcceptInvite";
import PortalHome from "./Components/Portal/PortalHome";
import PortalNewRequest from "./Components/Portal/PortalNewRequest";
import PortalTicket from "./Components/Portal/PortalTicket";
import ComingSoon from "./Components/Pages/ComingSoon";
import ScrollToTop from "./Components/ScrollToTop";

// Three parts:
// 1. Pages anyone can open: sign in, and accepting an invite
// 2. The customer portal (/portal/...), for customers
// 3. Everything else, for staff, inside the sidebar layout
export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/welcome/:id" element={<AcceptInvite />} />

        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<PortalHome />} />
          <Route path="new" element={<PortalNewRequest />} />
          <Route path="tickets/:id" element={<PortalTicket />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        <Route element={<StaffLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/assignment" element={<TicketAssignment />} />
          <Route path="/topics" element={<TicketTopics />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/automation" element={<Automation />} />
          <Route path="/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/team" element={<Team />} />
          <Route
            path="/email"
            element={<ComingSoon title="Email Integration" />}
          />
          <Route path="/reports" element={<Reports />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="*" element={<ComingSoon title="Page not found" />} />
        </Route>
      </Routes>
    </>
  );
}
