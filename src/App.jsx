import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router";
import StaffLayout from "./Components/StaffLayout";
import PortalLayout from "./Components/Portal/PortalLayout";
import LoadingScreen from "./Components/LoadingScreen";
import ScrollToTop from "./Components/ScrollToTop";

// Each page is its own small file that's only downloaded when it's first
// opened ("lazy"), instead of the whole app downloading at once. So the
// sign-in page and the website request form open quickly, and the charts
// on Reports only load if someone goes there. Once a page has been opened
// it's kept, so moving back to it is instant.
const Dashboard = lazy(() => import("./Components/Pages/Dashboard"));
const Inbox = lazy(() => import("./Components/Pages/Inbox"));
const Customers = lazy(() => import("./Components/Pages/Customers"));
const TicketDetail = lazy(() => import("./Components/Pages/TicketDetail"));
const CustomerDetail = lazy(() => import("./Components/Pages/CustomerDetail"));
const TicketReview = lazy(() => import("./Components/Pages/TicketReview"));
const TicketAssignment = lazy(
  () => import("./Components/Pages/TicketAssignment"),
);
const Automation = lazy(() => import("./Components/Pages/Automation"));
const KnowledgeBase = lazy(() => import("./Components/Pages/KnowledgeBase"));
const Reports = lazy(() => import("./Components/Pages/Reports"));
const Performance = lazy(() => import("./Components/Pages/Performance"));
const Team = lazy(() => import("./Components/Pages/Team"));
const Profile = lazy(() => import("./Components/Pages/Profile"));
const Settings = lazy(() => import("./Components/Pages/Settings"));
const Login = lazy(() => import("./Components/Pages/Login"));
const AcceptInvite = lazy(() => import("./Components/Pages/AcceptInvite"));
const ResetPassword = lazy(() => import("./Components/Pages/ResetPassword"));
const Feedback = lazy(() => import("./Components/Pages/Feedback"));
const RequestForm = lazy(() => import("./Components/Pages/RequestForm"));
const PortalHome = lazy(() => import("./Components/Portal/PortalHome"));
const PortalNewRequest = lazy(
  () => import("./Components/Portal/PortalNewRequest"),
);
const PortalTicket = lazy(() => import("./Components/Portal/PortalTicket"));
const Integrations = lazy(() => import("./Components/Pages/Integrations"));
const ComingSoon = lazy(() => import("./Components/Pages/ComingSoon"));

// Three parts:
// 1. Pages anyone can open: sign in, accepting an invite, and the
//    public request form (/request, also for putting on another website)
// 2. The customer portal (/portal/...), for customers
// 3. Everything else, for staff, inside the sidebar layout
// (Inside the two layouts, a page that's still downloading shows a small
// spinner in the page area; see StaffLayout and PortalLayout.)
export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/welcome/:id" element={<AcceptInvite />} />
          <Route path="/reset/:token" element={<ResetPassword />} />
          <Route path="/feedback/:token" element={<Feedback />} />
          <Route path="/request" element={<RequestForm />} />

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
            <Route path="/review" element={<TicketReview />} />
            {/* The old address of this page */}
            <Route path="/topics" element={<Navigate to="/review" replace />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/automation" element={<Automation />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/team" element={<Team />} />
            <Route path="/integrations" element={<Integrations />} />
            {/* The old address of this page */}
            <Route
              path="/email"
              element={<Navigate to="/integrations" replace />}
            />
            <Route path="/reports" element={<Reports />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="*" element={<ComingSoon title="Page not found" />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
