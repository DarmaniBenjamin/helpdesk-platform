import { Link, useNavigate } from "react-router";
import Card from "./Card";
import StatusBadge from "./StatusBadge";
import PriorityBadge from "./PriorityBadge";
import DueLabel from "./DueLabel";
import { timeAgo } from "../data";
import useData from "../useData";

// Same padding and bottom line for every cell
const cell = "border-b border-line px-4 py-3.5 group-last:border-0";

export default function LatestTickets() {
  const navigate = useNavigate();
  const { tickets } = useData();

  // tickets is already sorted newest first, so the first 7 are the latest
  const latest = tickets.slice(0, 7);

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
        <table className="w-full min-w-220 border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="whitespace-nowrap bg-brand/10 text-brand">
              <th className="rounded-l-lg px-4 py-3 font-medium">Ticket ID</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="rounded-r-lg px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {latest.map((ticket) => (
              <tr
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="group cursor-pointer transition hover:bg-page active:bg-brand/5"
              >
                <td className={`${cell} font-medium`}>#{ticket.id}</td>
                <td className={cell}>
                  <p className="whitespace-nowrap">{ticket.requester.name}</p>
                  <p
                    className="max-w-56 truncate text-xs text-muted"
                    title={ticket.requester.email}
                  >
                    {ticket.requester.email}
                  </p>
                </td>
                <td className={`${cell} min-w-48`}>{ticket.subject}</td>
                <td className={cell}>
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className={cell}>
                  <StatusBadge status={ticket.status} />
                </td>
                <td className={cell}>
                  <DueLabel ticket={ticket} />
                </td>
                <td className={`${cell} whitespace-nowrap text-muted`}>
                  {timeAgo(ticket.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
