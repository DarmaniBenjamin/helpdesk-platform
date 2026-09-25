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
import { DAY } from "../data";
import useData from "../useData";

// Short labels for the side of the chart: 120 -> "2h", 45 -> "45m"
function axisLabel(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

// 95 -> "1h 35m", 40 -> "40m"
function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Average first-response time (in minutes) for each of the last `days` days
function responseTimesByDay(tickets, days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = [];

  for (let i = days - 1; i >= 0; i--) {
    const start = today.getTime() - i * DAY;
    const end = start + DAY;
    const answered = tickets.filter(
      (t) => t.createdAt >= start && t.createdAt < end && t.firstRespondedAt,
    );
    const totalMinutes = answered.reduce(
      (sum, t) => sum + (t.firstRespondedAt - t.createdAt) / 60000,
      0,
    );
    const date = new Date(start);

    result.push({
      date: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      minutes: answered.length ? Math.round(totalMinutes / answered.length) : 0,
      count: answered.length,
    });
  }
  return result;
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md">
      <p className="text-muted">
        {item.day}, {item.date}
      </p>
      <p className="text-sm font-semibold">
        {item.count ? formatMinutes(item.minutes) : "No tickets"}
      </p>
      {item.count > 0 && (
        <p className="text-muted">avg. across {item.count} tickets</p>
      )}
    </div>
  );
}

export default function ResponseTimeChart() {
  const { tickets } = useData();
  const [days, setDays] = useState(14);
  const [hovered, setHovered] = useState(null);
  const data = responseTimesByDay(tickets, days);

  return (
    <Card
      title="Response Time Trend"
      action={
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm text-muted focus:border-brand focus:outline-none"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 2 weeks</option>
        </select>
      }
    >
      <div className="h-64 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} onMouseLeave={() => setHovered(null)}>
            <CartesianGrid
              vertical={false}
              strokeDasharray="4 4"
              stroke="#eaecf0"
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date) =>
                data.find((item) => item.date === date).day
              }
              interval="preserveStartEnd"
              minTickGap={6}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#667085" }}
            />
            <YAxis
              tickFormatter={axisLabel}
              tickLine={false}
              axisLine={false}
              width={36}
              tick={{ fontSize: 11, fill: "#667085" }}
            />
            <Tooltip content={<ChartTooltip />} cursor={false} />
            <Bar
              dataKey="minutes"
              radius={[6, 6, 0, 0]}
              onMouseEnter={(_, index) => setHovered(index)}
            >
              {data.map((item, index) => (
                <Cell
                  key={item.date}
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
