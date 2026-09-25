import { Link, useNavigate } from "react-router";
import Card from "./Card";

const latestTickets = [
  {
    id: 4821,
    name: "Liam Smith",
    email: "liam@gmail.com",
    subject: "PC not turning on",
    created: "30 min ago",
    status: "New",
  },
  {
    id: 4820,
    name: "Olivia Brown",
    email: "olivia@gmail.com",
    subject: "Desktop won't boot up",
    created: "1 hour ago",
    status: "Open",
  },
  {
    id: 4819,
    name: "Sophia Wilson",
    email: "sophia@gmail.com",
    subject: "Phone won't turn on",
    created: "3 hours ago",
    status: "In Progress",
  },
  {
    id: 4818,
    name: "James Taylor",
    email: "james@gmail.com",
    subject: "Monitor is blank",
    created: "4 hours ago",
    status: "Closed",
  },
  {
    id: 4817,
    name: "Noah Davis",
    email: "noah@gmail.com",
    subject: "Tablet is unresponsive",
    created: "5 hours ago",
    status: "Open",
  },
  {
    id: 4816,
    name: "Mason Amel",
    email: "mason@gmail.com",
    subject: "Router not connecting",
    created: "6 hours ago",
    status: "In Progress",
  },
  {
    id: 4815,
    name: "Ava Thomas",
    email: "ava@gmail.com",
    subject: "Smartwatch won't sync",
    created: "7 hours ago",
    status: "New",
  },
];

const statusStyles = {
  New: "bg-sky-50 text-sky-600 ring-sky-200",
  Open: "bg-amber-50 text-amber-600 ring-amber-200",
  "In Progress": "bg-rose-50 text-rose-600 ring-rose-200",
  Closed: "bg-emerald-50 text-emerald-600 ring-emerald-200",
};

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusStyles[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export default function LatestTickets() {
  const navigate = useNavigate();

  return (
    <Card
      title="Latest Tickets"
      action={
        <Link
          to="/inbox"
          className="text-sm font-medium text-brand hover:underline"
        >
          View all
        </Link>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-180 border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="bg-brand/10 text-brand">
              <th className="rounded-l-lg px-4 py-3 font-medium">Ticket ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="rounded-r-lg px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {latestTickets.map((ticket) => (
              <tr
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="group cursor-pointer transition hover:bg-page active:bg-brand/5"
              >
                <td className="border-b border-line px-4 py-3.5 font-medium group-last:border-0">
                  #{ticket.id}
                </td>
                <td className="border-b border-line px-4 py-3.5 group-last:border-0">
                  {ticket.name}
                </td>
                <td className="border-b border-line px-4 py-3.5 text-muted group-last:border-0">
                  {ticket.email}
                </td>
                <td className="border-b border-line px-4 py-3.5 group-last:border-0">
                  {ticket.subject}
                </td>
                <td className="border-b border-line px-4 py-3.5 text-muted group-last:border-0">
                  {ticket.created}
                </td>
                <td className="border-b border-line px-4 py-3.5 group-last:border-0">
                  <StatusBadge status={ticket.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
