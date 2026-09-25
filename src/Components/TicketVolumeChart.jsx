import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import Card from "./Card";

const volume = [
  { name: "Open", value: 65, color: "#00b67a" },
  { name: "In Progress", value: 34, color: "#1f8a5f" },
  { name: "High", value: 45, color: "#16372c" },
  { name: "Resolved", value: 12, color: "#7ee2c1" },
];

export default function TicketVolumeChart() {
  const [hovered, setHovered] = useState(null);
  const total = volume.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card
      title="Ticket Volume"
      action={
        <select className="h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm text-muted focus:border-brand focus:outline-none">
          <option>September, 2025</option>
          <option>August, 2025</option>
          <option>July, 2025</option>
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
                  key={item.name}
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
            {hovered === null ? total : volume[hovered].value}
          </span>
          <span className="text-sm text-muted">
            {hovered === null ? "Tickets" : volume[hovered].name}
          </span>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {volume.map((item) => (
          <li key={item.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
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
