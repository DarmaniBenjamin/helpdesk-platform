import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import Card from "./Card";
import { tickets, STATUSES } from "../data";

// Green shades from the design, one per status
const COLORS = {
  open: "#00b67a",
  pending: "#1f8a5f",
  waiting: "#16372c",
  resolved: "#7ee2c1",
  closed: "#c3d9cf",
};

// The current month and the two before it, e.g. "September 2026"
function lastThreeMonths() {
  const months = [];
  const today = new Date();
  for (let i = 0; i < 3; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
      start: date.getTime(),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime(),
    });
  }
  return months;
}

export default function TicketVolumeChart() {
  const months = lastThreeMonths();
  const [monthKey, setMonthKey] = useState(months[0].key);
  const [hovered, setHovered] = useState(null);

  // Tickets created in the chosen month, counted by status
  const month = months.find((m) => m.key === monthKey);
  const inMonth = tickets.filter(
    (t) => t.createdAt >= month.start && t.createdAt < month.end,
  );
  const volume = Object.keys(STATUSES)
    .map((status) => ({
      status,
      name: STATUSES[status].label,
      value: inMonth.filter((t) => t.status === status).length,
      color: COLORS[status],
    }))
    .filter((item) => item.value > 0);

  return (
    <Card
      title="Ticket Volume"
      action={
        <select
          value={monthKey}
          onChange={(e) => {
            setMonthKey(e.target.value);
            setHovered(null);
          }}
          className="h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm text-muted focus:border-brand focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="relative h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={volume}
              dataKey="value"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              onMouseEnter={(_, index) => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              {volume.map((item, index) => (
                <Cell
                  key={item.status}
                  fill={item.color}
                  opacity={hovered === null || hovered === index ? 1 : 0.35}
                  style={{
                    transition: "opacity 200ms",
                    cursor: "pointer",
                    outline: "none",
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold">
            {hovered === null ? inMonth.length : volume[hovered]?.value}
          </span>
          <span className="text-sm text-muted">
            {hovered === null ? "Tickets" : volume[hovered]?.name}
          </span>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {volume.map((item) => (
          <li key={item.status} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="flex-1">{item.name}</span>
            <span className="text-muted">{item.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
