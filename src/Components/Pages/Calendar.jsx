import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Ticket,
} from "lucide-react";
import Avatar from "../Avatar";
import Droplets from "../Droplets";
import JobModal from "../JobModal";
import { JOB_KINDS } from "../jobKinds";
import { api } from "../../api";
import useData from "../../useData";

// The calendar: who's doing which job, when (server/src/jobs.js).
//   Day    one column per agent, so the whole team's day side by side
//   Week   seven days, for everyone or one agent
//   Month  the overview; click a day to open it
//   List   the next two weeks as a list (the default on phones)
// Click an empty time to book a job there; click a job to change it. With
// a mouse, drag a job to move it (to another time, day, or agent in Day
// view) and drag its bottom edge to make it longer or shorter.
// What's shown is kept in the address (?view=week&date=2026-10-05&agent=…),
// so a refresh or a shared link shows the same thing.

const DAY = 24 * 60 * 60 * 1000;
const FIRST_HOUR = 6; // the time grid runs 6:00 to 21:00
const LAST_HOUR = 21;
const HOUR_PX = 56;
const SNAP = 15; // minutes
const VIEWS = ["day", "week", "month", "list"];

// Each agent's colour on the calendar (the same agent always gets the
// same one)
const PALETTE = [
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
];

// ---------- Dates ----------

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (ms, n) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
// Weeks start on Monday
const startOfWeek = (ms) => {
  const d = new Date(startOfDay(ms));
  return addDays(d.getTime(), -((d.getDay() + 6) % 7));
};
const startOfMonth = (ms) => {
  const d = new Date(startOfDay(ms));
  d.setDate(1);
  return d.getTime();
};
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromIso = (text) => {
  const ms = new Date(`${text}T00:00`).getTime();
  return Number.isNaN(ms) ? startOfDay(Date.now()) : ms;
};
const fmt = (ms, options) => new Date(ms).toLocaleString("en-US", options);
const timeLabel = (ms) =>
  fmt(ms, { hour: "numeric", minute: "2-digit" }).replace(":00", "");

// What a view shows: [from, to)
function rangeFor(view, date) {
  if (view === "day") return [date, addDays(date, 1)];
  if (view === "week") {
    const s = startOfWeek(date);
    return [s, addDays(s, 7)];
  }
  if (view === "month") {
    const s = startOfWeek(startOfMonth(date));
    return [s, addDays(s, 42)];
  }
  return [date, addDays(date, 14)]; // list
}

function titleFor(view, date) {
  if (view === "day")
    return fmt(date, { weekday: "long", month: "long", day: "numeric" });
  if (view === "week") {
    const s = startOfWeek(date);
    const e = addDays(s, 6);
    return `${fmt(s, { month: "short", day: "numeric" })} – ${fmt(e, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (view === "month") return fmt(date, { month: "long", year: "numeric" });
  return `${fmt(date, { month: "short", day: "numeric" })} – ${fmt(addDays(date, 13), { month: "short", day: "numeric" })}`;
}

// Side-by-side places for jobs that overlap in one column: each gets a
// lane, and the width is shared between the lanes in use at that time
function placeJobs(items) {
  const sorted = [...items].sort(
    (a, b) => a.top - b.top || b.bottom - a.bottom,
  );
  const lanes = [];
  let group = [];
  let groupEnd = -1;
  const done = [];
  const finish = () => {
    const count = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) done.push({ ...g, lanes: count });
    group = [];
  };
  for (const item of sorted) {
    if (item.top >= groupEnd && group.length) {
      finish();
      lanes.length = 0;
    }
    let lane = lanes.findIndex((end) => end <= item.top);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = item.bottom;
    group.push({ ...item, lane });
    groupEnd = Math.max(groupEnd, item.bottom);
  }
  if (group.length) finish();
  return done;
}

// The time now, ticking every minute (for "today" and the red line)
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// ---------- The time grid (Day and Week) ----------

// columns: [{ key, label, sub, day (start of day ms), agentId? }]
function TimeGrid({
  now,
  columns,
  jobs,
  colorOf,
  nameOf,
  canMove,
  onSlot,
  onOpen,
  onMove,
}) {
  const gridRef = useRef(null);
  // How the last press was made: a tap on a touch screen opens the job
  // (dragging is for mouse and pen)
  const pressedWith = useRef("mouse");
  const [drag, setDrag] = useState(null); // { job, mode, startY, startX, dy, col }
  const hours = Array.from(
    { length: LAST_HOUR - FIRST_HOUR },
    (_, i) => FIRST_HOUR + i,
  );
  const height = (LAST_HOUR - FIRST_HOUR) * HOUR_PX;

  // Minutes from the top of the grid for a time on a given day
  const minutesIn = (ms, day) => (ms - day) / 60000 - FIRST_HOUR * 60;
  const px = (minutes) => (minutes / 60) * HOUR_PX;

  // The jobs in each column, placed
  const placed = columns.map((col) => {
    const dayEnd = col.day + DAY;
    const items = jobs
      .filter(
        (j) =>
          j.start < dayEnd &&
          j.end > col.day &&
          (!col.agentId || j.agents.includes(col.agentId)),
      )
      .map((j) => {
        const top = Math.max(0, minutesIn(j.start, col.day));
        const bottom = Math.min(
          (LAST_HOUR - FIRST_HOUR) * 60,
          minutesIn(j.end, col.day),
        );
        return { job: j, top, bottom: Math.max(bottom, top + 20) };
      })
      .filter((i) => i.top < (LAST_HOUR - FIRST_HOUR) * 60 && i.bottom > 0);
    return placeJobs(items);
  });

  // Which column is under the pointer (for dragging sideways)
  function columnAt(clientX) {
    const cells = gridRef.current?.querySelectorAll("[data-col]") ?? [];
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right)
        return Number(cell.dataset.col);
    }
    return null;
  }

  function startDrag(e, job, colIndex, mode) {
    // Mouse and pen only: on touch screens, tap opens the job instead
    if (e.pointerType === "touch" || e.button !== 0 || !canMove(job)) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({
      job,
      mode,
      startY: e.clientY,
      startX: e.clientX,
      dy: 0,
      col: colIndex,
      fromCol: colIndex,
      moved: false,
    });
  }

  function moveDrag(e) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const col =
      drag.mode === "move" ? (columnAt(e.clientX) ?? drag.col) : drag.col;
    const moved =
      drag.moved || Math.abs(dy) > 4 || Math.abs(e.clientX - drag.startX) > 4;
    setDrag({ ...drag, dy, col, moved });
  }

  function endDrag() {
    if (!drag) return;
    const { job, mode, dy, col, fromCol, moved } = drag;
    setDrag(null);
    if (!moved) return onOpen(job);
    const minutes = Math.round(((dy / HOUR_PX) * 60) / SNAP) * SNAP;
    if (mode === "resize") {
      const end = Math.max(job.start + SNAP * 60000, job.end + minutes * 60000);
      if (end !== job.end) onMove(job, { end });
      return;
    }
    const shift = minutes * 60000 + (columns[col].day - columns[fromCol].day);
    const changes = {};
    if (shift) {
      changes.start = job.start + shift;
      changes.end = job.end + shift;
    }
    // Day view: dropped in another agent's column, so it's theirs now
    const fromAgent = columns[fromCol].agentId;
    const toAgent = columns[col].agentId;
    if (fromAgent && toAgent && fromAgent !== toAgent) {
      changes.agents = [
        ...new Set(job.agents.map((a) => (a === fromAgent ? toAgent : a))),
      ];
    }
    if (Object.keys(changes).length) onMove(job, changes);
  }

  // Clicking an empty spot: book a job there (snapped to half hours)
  function clickSlot(e, col) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes =
      Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30 + FIRST_HOUR * 60;
    const start = col.day + minutes * 60000;
    onSlot(start, col.agentId);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <div
        ref={gridRef}
        className="grid"
        style={{
          gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(${columns.length > 4 ? "7.5rem" : "10rem"}, 1fr))`,
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        {/* Column headings */}
        <div className="sticky left-0 z-10 border-b border-line bg-white" />
        {columns.map((col) => (
          <div
            key={col.key}
            className={`flex min-w-0 items-center gap-2 border-b border-l border-line px-2 py-2 ${
              col.today ? "bg-brand/5" : ""
            }`}
          >
            {col.avatar}
            <div className="min-w-0">
              <p
                className={`truncate text-sm font-medium ${col.today ? "text-brand" : ""}`}
              >
                {col.label}
              </p>
              {col.sub && (
                <p className="truncate text-xs text-muted">{col.sub}</p>
              )}
            </div>
          </div>
        ))}

        {/* Hours down the side */}
        <div className="sticky left-0 z-10 bg-white" style={{ height }}>
          {hours.map((h) => (
            <div
              key={h}
              className="relative border-t border-line/60 text-right"
              style={{ height: HOUR_PX }}
            >
              <span className="absolute -top-2 right-1.5 bg-white px-0.5 text-[10px] text-muted">
                {timeLabel(new Date(2026, 0, 1, h).getTime())}
              </span>
            </div>
          ))}
        </div>

        {/* The columns */}
        {columns.map((col, ci) => {
          const showNow = now >= col.day && now < col.day + DAY;
          const nowTop = px(minutesIn(now, col.day));
          return (
            <div
              key={col.key}
              data-col={ci}
              className={`relative border-l border-line ${drag?.col === ci && drag.moved ? "bg-brand/5" : ""}`}
              style={{ height }}
              onClick={(e) => e.target === e.currentTarget && clickSlot(e, col)}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="pointer-events-none border-t border-line/60"
                  style={{ height: HOUR_PX }}
                />
              ))}
              {showNow && nowTop > 0 && nowTop < height && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                  style={{ top: nowTop }}
                >
                  <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
                </div>
              )}
              {placed[ci].map(({ job, top, bottom, lane, lanes }) => {
                const dragging = drag?.job.id === job.id && drag.moved;
                const isMoving = dragging && drag.mode === "move";
                const extra = dragging ? drag.dy : 0;
                // Day view: each agent's own colour in their column
                const color = colorOf(job, col.agentId);
                const Icon = JOB_KINDS[job.kind]?.icon ?? CalendarDays;
                const h =
                  px(bottom - top) +
                  (dragging && drag.mode === "resize" ? extra : 0);
                // While moving sideways it's drawn in the column it's over
                if (isMoving && drag.col !== ci) return null;
                return (
                  <div
                    key={`${job.id}-${col.key}`}
                    onPointerDown={(e) => {
                      pressedWith.current = e.pointerType;
                      startDrag(e, job, ci, "move");
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // (a mouse click opens it at the end of the "drag")
                      if (!canMove(job) || pressedWith.current === "touch")
                        onOpen(job);
                    }}
                    className={`absolute cursor-pointer overflow-hidden rounded-md px-1.5 py-1 text-xs shadow-sm transition-shadow hover:shadow-md ${
                      job.done ? "opacity-55" : ""
                    } ${dragging ? "z-20 shadow-lg ring-2 ring-brand/40" : "z-[5]"} ${canMove(job) ? "select-none" : ""}`}
                    style={{
                      top: px(top) + (isMoving ? extra : 0),
                      height: Math.max(18, h),
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                      background: `${color}1f`,
                      borderLeft: `3px solid ${color}`,
                      touchAction: canMove(job) ? "none" : "auto",
                    }}
                    title={`${job.title} · ${timeLabel(job.start)}–${timeLabel(job.end)}`}
                  >
                    <p className="flex items-center gap-1 font-medium leading-tight">
                      {job.done ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <Icon className="h-3 w-3 shrink-0" style={{ color }} />
                      )}
                      <span
                        className={`truncate ${job.done ? "line-through" : ""}`}
                      >
                        {job.title}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {timeLabel(job.start)}–{timeLabel(job.end)}
                      {job.customerName ? ` · ${job.customerName}` : ""}
                    </p>
                    {!col.agentId && bottom - top >= 60 && (
                      <p className="truncate text-[11px] text-muted">
                        {job.agents.map(nameOf).join(", ")}
                      </p>
                    )}
                    {canMove(job) && (
                      <div
                        onPointerDown={(e) => startDrag(e, job, ci, "resize")}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Month ----------

function MonthGrid({ today, date, jobs, colorOf, onDay, onOpen }) {
  const first = startOfWeek(startOfMonth(date));
  const month = new Date(date).getMonth();
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = jobs.filter((j) => j.start < day + DAY && j.end > day);
          const other = new Date(day).getMonth() !== month;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onDay(day)}
              className={`flex min-h-24 cursor-pointer flex-col gap-1 border-b border-l border-line p-1.5 text-left transition hover:bg-page sm:min-h-28 ${
                other ? "bg-page/60 text-muted" : ""
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  day === today ? "bg-brand font-semibold text-white" : ""
                }`}
              >
                {new Date(day).getDate()}
              </span>
              {list.slice(0, 3).map((j) => (
                <span
                  key={j.id}
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(j);
                  }}
                  className={`truncate rounded px-1 py-0.5 text-[11px] ${j.done ? "line-through opacity-60" : ""}`}
                  style={{
                    background: `${colorOf(j)}1f`,
                    borderLeft: `2px solid ${colorOf(j)}`,
                  }}
                >
                  <span className="hidden sm:inline">
                    {timeLabel(j.start)}{" "}
                  </span>
                  {j.title}
                </span>
              ))}
              {list.length > 3 && (
                <span className="text-[11px] text-muted">
                  +{list.length - 3} more
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- List ----------

function JobList({ today, from, jobs, colorOf, nameOf, team, onOpen }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const withJobs = days
    .map((day) => ({
      day,
      list: jobs.filter((j) => j.start < day + DAY && j.end > day),
    }))
    .filter((d) => d.list.length);
  if (!withJobs.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white px-4 py-14 text-center">
        <CalendarDays className="h-8 w-8 text-muted" />
        <p className="font-medium">No jobs in these two weeks</p>
        <p className="text-sm text-muted">Book one with the button above.</p>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {withJobs.map(({ day, list }) => (
        <section key={day}>
          <h2
            className={`mb-2 text-sm font-semibold ${day === today ? "text-brand" : ""}`}
          >
            {day === today
              ? "Today"
              : day === addDays(today, 1)
                ? "Tomorrow"
                : fmt(day, { weekday: "long", month: "short", day: "numeric" })}
          </h2>
          <ul className="flex flex-col gap-2">
            {list.map((j) => {
              const Icon = JOB_KINDS[j.kind]?.icon ?? CalendarDays;
              return (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(j)}
                    className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line bg-white p-3 text-left transition hover:border-brand/30 ${j.done ? "opacity-60" : ""}`}
                    style={{ borderLeft: `4px solid ${colorOf(j)}` }}
                  >
                    <div className="w-16 shrink-0 text-sm">
                      <p className="font-medium">{timeLabel(j.start)}</p>
                      <p className="text-xs text-muted">{timeLabel(j.end)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`flex items-center gap-1.5 font-medium ${j.done ? "line-through" : ""}`}
                      >
                        <Icon
                          className="h-4 w-4 shrink-0"
                          style={{ color: colorOf(j) }}
                        />
                        <span className="truncate">{j.title}</span>
                      </p>
                      <p className="truncate text-sm text-muted">
                        {[JOB_KINDS[j.kind]?.label, j.customerName, j.location]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {j.ticketId && (
                        <p className="flex items-center gap-1 text-xs text-muted">
                          <Ticket className="h-3 w-3" />#{j.ticketId}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 -space-x-2">
                      {j.agents.slice(0, 3).map((id) => {
                        const m = team.find((t) => t.id === id);
                        return (
                          <span
                            key={id}
                            className="rounded-full ring-2 ring-white"
                            title={nameOf(id)}
                          >
                            <Avatar
                              name={nameOf(id)}
                              photo={m?.photo}
                              size="sm"
                            />
                          </span>
                        );
                      })}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- The page ----------

export default function Calendar() {
  const { team, me, jobsVersion } = useData();
  const [params, setParams] = useSearchParams();
  const isAdmin = me.role === "owner" || me.role === "admin";
  const phone = typeof window !== "undefined" && window.innerWidth < 640;

  const view = VIEWS.includes(params.get("view"))
    ? params.get("view")
    : phone
      ? "list"
      : "week";
  const now = useNow();
  const today = startOfDay(now);
  const date = params.get("date") ? fromIso(params.get("date")) : today;
  // Whose jobs: "all", or one person (agents start on their own)
  const agentParam = params.get("agent");
  const agent = agentParam ?? (isAdmin ? "all" : me.id);

  const go = useCallback(
    (changes) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const staff = useMemo(
    () =>
      team
        .filter((m) => m.role !== "customer" && m.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [team],
  );
  const colors = useMemo(() => {
    const map = {};
    staff.forEach((m, i) => (map[m.id] = PALETTE[i % PALETTE.length]));
    return map;
  }, [staff]);
  const nameOf = (id) => {
    const m = team.find((t) => t.id === id);
    return m?.name || m?.email || "Someone";
  };
  // A job's colour: its first agent's (or the chosen agent's, if they're on it)
  const colorOf = (job, inColumnOf) =>
    colors[
      inColumnOf ??
        (agent !== "all" && job.agents.includes(agent) ? agent : job.agents[0])
    ] ?? "#64748b";
  const canMove = (job) =>
    isAdmin || job.agents.includes(me.id) || job.createdById === me.id;

  // The jobs in view
  const [from, to] = rangeFor(view, date);
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api(`/jobs?from=${from}&to=${to}`)
      .then((list) => !cancelled && setJobs(list))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [from, to, jobsVersion]);

  const shown = (jobs ?? []).filter(
    (j) => agent === "all" || j.agents.includes(agent),
  );

  // The job being booked or changed
  const [editing, setEditing] = useState(null);
  const bookAt = (start, agentId) =>
    setEditing({
      start,
      end: start + 60 * 60 * 1000,
      agents: [agentId ?? (agent !== "all" ? agent : me.id)],
    });

  function saved(job) {
    setJobs((list) => [...(list ?? []).filter((j) => j.id !== job.id), job]);
    setEditing(null);
  }

  // Dragged on the calendar: shown straight away, put back if it fails
  async function move(job, changes) {
    const before = jobs;
    setJobs((list) =>
      list.map((j) => (j.id === job.id ? { ...j, ...changes } : j)),
    );
    setError("");
    try {
      const updated = await api(`/jobs/${job.id}`, {
        method: "PATCH",
        body: changes,
      });
      setJobs((list) => list.map((j) => (j.id === job.id ? updated : j)));
    } catch (err) {
      setJobs(before);
      setError(err.message);
    }
  }

  const step = (dir) => {
    const next =
      view === "day"
        ? addDays(date, dir)
        : view === "week" || view === "list"
          ? addDays(date, 7 * dir)
          : (() => {
              const d = new Date(startOfMonth(date));
              d.setMonth(d.getMonth() + dir);
              return d.getTime();
            })();
    go({ date: isoDay(next) });
  };

  // The columns for the time grid
  const columns =
    view === "day"
      ? (agent === "all" ? staff : staff.filter((m) => m.id === agent)).map(
          (m) => ({
            key: m.id,
            day: date,
            agentId: m.id,
            label: m.name || m.email,
            sub: (() => {
              const n = shown.filter(
                (j) =>
                  j.agents.includes(m.id) &&
                  j.start < date + DAY &&
                  j.end > date,
              ).length;
              return `${n} job${n === 1 ? "" : "s"}`;
            })(),
            avatar: (
              <span
                className="rounded-full ring-2"
                style={{ "--tw-ring-color": colors[m.id] }}
              >
                <Avatar name={m.name || m.email} photo={m.photo} size="sm" />
              </span>
            ),
          }),
        )
      : Array.from({ length: 7 }, (_, i) => {
          const day = addDays(startOfWeek(date), i);
          return {
            key: String(day),
            day,
            today: day === today,
            label: fmt(day, { weekday: "short", day: "numeric" }),
          };
        });

  const segment =
    "flex h-9 cursor-pointer items-center rounded-md px-3 text-sm transition active:scale-[0.97]";

  return (
    <div className="flex flex-col gap-4">
      {/* Title and booking */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Calendar</h1>
          <p className="mt-1 text-sm text-muted">{titleFor(view, date)}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = new Date();
            next.setMinutes(0, 0, 0);
            next.setHours(next.getHours() + 1);
            bookAt(
              view === "day" || date !== today
                ? date + Math.max(9, Math.min(17, next.getHours())) * 3600000
                : next.getTime(),
            );
          }}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97]"
        >
          <CalendarPlus className="h-4 w-4" />
          Book a job
        </button>
      </div>

      {/* Moving around, the view, and whose jobs */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Back"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-white transition hover:bg-page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go({ date: null })}
            className="h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm transition hover:bg-page"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-white transition hover:bg-page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex w-max gap-1 rounded-lg border border-line bg-white p-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => go({ view: v })}
              className={`${segment} ${view === v ? "bg-brand/10 font-medium text-brand" : "text-muted hover:text-ink"}`}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <select
          value={agent}
          onChange={(e) => go({ agent: e.target.value })}
          className="h-10 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm sm:ml-auto"
          aria-label="Whose jobs"
        >
          <option value="all">Everyone</option>
          {staff.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === me.id ? `Me (${m.name || m.email})` : m.name || m.email}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {jobs === null ? (
        <div className="flex justify-center py-20">
          <Droplets className="h-10 w-10 text-brand" />
        </div>
      ) : view === "month" ? (
        <MonthGrid
          today={today}
          date={date}
          jobs={shown}
          colorOf={colorOf}
          onDay={(day) => go({ view: "day", date: isoDay(day) })}
          onOpen={setEditing}
        />
      ) : view === "list" ? (
        <JobList
          today={today}
          from={date}
          jobs={shown}
          colorOf={colorOf}
          nameOf={nameOf}
          team={team}
          onOpen={setEditing}
        />
      ) : (
        <>
          <TimeGrid
            now={now}
            columns={columns}
            jobs={shown}
            colorOf={colorOf}
            nameOf={nameOf}
            canMove={canMove}
            onSlot={bookAt}
            onOpen={setEditing}
            onMove={move}
          />
          <p className="text-xs text-muted">
            Click an empty time to book a job there. With a mouse, drag a job to
            move it
            {view === "day"
              ? " (onto someone else's column to give it to them)"
              : ""}
            , or drag its bottom edge to change how long it is.
          </p>
        </>
      )}

      {editing && (
        <JobModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onDeleted={(id) => {
            setJobs((list) => list.filter((j) => j.id !== id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
