import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";
import Card from "./Card";

const responseTimes = [
  { date: "Sep 20", day: "Sat", minutes: 165 },
  { date: "Sep 21", day: "Sun", minutes: 230 },
  { date: "Sep 22", day: "Mon", minutes: 175 },
  { date: "Sep 23", day: "Tue", minutes: 140 },
  { date: "Sep 24", day: "Wed", minutes: 115 },
  { date: "Sep 25", day: "Thu", minutes: 165 },
  { date: "Sep 26", day: "Fri", minutes: 190 },
  { date: "Sep 27", day: "Sat", minutes: 350 },
  { date: "Sep 28", day: "Sun", minutes: 290 },
  { date: "Sep 29", day: "Mon", minutes: 240 },
  { date: "Sep 30", day: "Tue", minutes: 165 },
  { date: "Oct 1", day: "Wed", minutes: 195 },
  { date: "Oct 2", day: "Thu", minutes: 180 },
  { date: "Oct 3", day: "Fri", minutes: 185 },
];

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md">
      <p className="text-muted">
        {payload[0].payload.day}, {payload[0].payload.date}
      </p>
      <p className="text-sm font-semibold">{payload[0].value} min</p>
    </div>
  );
}

export default function ResponseTimeChart() {
  const [hovered, setHovered] = useState(null);

  return (
    <Card
      title="Response Time Trend"
      action={
        <select className="h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm text-muted focus:border-brand focus:outline-none">
          <option>Last 2 weeks</option>
          <option>Last month</option>
          <option>Last 3 months</option>
        </select>
      }
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={responseTimes} onMouseLeave={() => setHovered(null)}>
            <CartesianGrid
              vertical={false}
              strokeDasharray="4 4"
              stroke="#eaecf0"
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date) =>
                responseTimes.find((item) => item.date === date).day
              }
              interval="preserveStartEnd"
              minTickGap={6}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#667085" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              tick={{ fontSize: 11, fill: "#667085" }}
            />
            <Tooltip content={<ChartTooltip />} cursor={false} />
            <Bar
              dataKey="minutes"
              radius={[6, 6, 0, 0]}
              onMouseEnter={(_, index) => setHovered(index)}
            >
              {responseTimes.map((item, index) => (
                <Cell
                  key={index}
                  fill={hovered === index ? "#00b67a" : "#e4e7ec"}
                  style={{ transition: "fill 200ms", cursor: "pointer" }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
