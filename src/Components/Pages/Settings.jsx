import { useSearchParams } from "react-router";
import { ArrowDownToLine, ShieldCheck } from "lucide-react";
import FreshdeskImport from "../FreshdeskImport";
import BackupRestore from "../BackupRestore";

// The tabs across the top. The open tab is kept in the address
// (/settings?tab=backup) so refreshing or sharing the link keeps it.
const TABS = [
  {
    id: "import",
    label: "Import from Freshdesk",
    short: "Import",
    icon: ArrowDownToLine,
  },
  {
    id: "backup",
    label: "Backup & Restore",
    short: "Backup",
    icon: ShieldCheck,
  },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab"))
    ? params.get("tab")
    : TABS[0].id;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Bring your data over from Freshdesk, and keep it backed up.
        </p>
      </div>

      <div
        role="tablist"
        className="flex rounded-lg border border-line bg-white p-1 text-sm sm:w-fit"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 transition active:scale-[0.97] sm:flex-none ${
                active
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "import" ? <FreshdeskImport /> : <BackupRestore />}
    </div>
  );
}
