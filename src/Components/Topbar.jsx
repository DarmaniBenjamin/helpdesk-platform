import { useState } from "react";
import {
  Menu,
  PanelLeft,
  Search,
  Bell,
  Sun,
  Plus,
  ChevronDown,
  X,
} from "lucide-react";

function IconButton({
  icon: Icon,
  label,
  dot,
  iconEffect = "",
  onClick,
  className = "",
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`group relative cursor-pointer rounded-lg p-2 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92] ${className}`}
    >
      <Icon
        className={`h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${iconEffect}`}
      />
      {dot && (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
      )}
    </button>
  );
}

export default function Topbar({ onMenuClick }) {
  // Is the full-width search open on phones?
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="relative flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-white px-4 sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {/* Phones/tablets: opens the menu */}
        <IconButton
          icon={Menu}
          label="Open menu"
          onClick={onMenuClick}
          className="lg:hidden"
        />
        {/* Desktop: collapse button from the design */}
        <IconButton
          icon={PanelLeft}
          label="Toggle sidebar"
          className="hidden lg:block"
        />

        <div className="hidden items-center gap-3 text-sm text-muted sm:flex">
          <span>Dashboard</span>
          <span className="text-muted/50">/</span>
        </div>

        <div className="relative ml-2 hidden md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search"
            className="h-10 w-48 rounded-lg border border-line bg-page pl-9 pr-12 text-sm transition-all duration-300 placeholder:text-muted focus:w-64 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 lg:w-64 lg:focus:w-80"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line bg-white px-1.5 text-xs text-muted">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-3">
        {/* Phones: search icon instead of the full box */}
        <IconButton
          icon={Search}
          label="Search"
          onClick={() => setSearchOpen(true)}
          className="md:hidden"
        />
        <IconButton
          icon={Bell}
          label="Notifications"
          dot
          iconEffect="group-hover:rotate-12"
        />
        <IconButton
          icon={Sun}
          label="Toggle theme"
          iconEffect="group-hover:rotate-90"
          className="hidden sm:block"
        />

        <button className="group flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand/30 active:translate-y-0 active:scale-[0.97] sm:px-4">
          <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
          <span className="hidden sm:inline">Add Ticket</span>
        </button>

        <button className="group flex cursor-pointer items-center gap-2 rounded-lg p-1.5 transition hover:bg-brand/10 active:scale-[0.97]">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-medium text-white ring-2 ring-transparent transition group-hover:ring-brand/40">
            SA
          </div>
          <span className="hidden text-sm font-medium lg:block">SM Ashik</span>
          <ChevronDown className="hidden h-4 w-4 text-muted transition-transform duration-200 group-hover:translate-y-0.5 sm:block" />
        </button>
      </div>

      {/* Phones: search bar that covers the whole top bar when opened */}
      {searchOpen && (
        <div className="absolute inset-0 z-10 flex items-center gap-2 bg-white px-4 md:hidden">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search tickets"
              autoFocus
              onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
              className="h-10 w-full rounded-lg border border-brand bg-white pl-9 pr-3 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <IconButton
            icon={X}
            label="Close search"
            onClick={() => setSearchOpen(false)}
          />
        </div>
      )}
    </header>
  );
}
