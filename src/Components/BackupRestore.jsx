import { useRef, useState } from "react";
import {
  Download,
  Upload,
  HardDrive,
  Cloud,
  Database,
  CircleCheck,
  TriangleAlert,
  GitBranch,
  RotateCcw,
  FileJson,
  X,
} from "lucide-react";
import Card from "./Card";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import {
  downloadJson,
  readJsonFile,
  backupFileName,
  checkBackup,
  backupSummary,
} from "./backupUtils";
import { timeAgo } from "../data";
import useData from "../useData";

// Where automatic backups go
const DESTINATIONS = [
  {
    id: "download",
    label: "This device",
    hint: "Download backup files yourself. Works now.",
    icon: HardDrive,
    ready: true,
  },
  {
    id: "gdrive",
    label: "Google Drive",
    hint: "Saved to a folder in your Google Drive.",
    icon: Cloud,
    ready: false,
  },
  {
    id: "b2",
    label: "Backblaze B2",
    hint: "Saved to a private B2 bucket.",
    icon: Database,
    ready: false,
  },
];

const RECOVERY_STEPS = [
  {
    title: "Put the website back",
    text: "Redeploy it from your GitHub repo. That brings back the app itself, but none of your data.",
  },
  {
    title: "Sign in",
    text: "Sign in as the owner, then open Settings and go to Backup & Restore.",
  },
  {
    title: "Restore your latest backup",
    text: "Pick the newest backup file from Google Drive, Backblaze or your device.",
  },
  {
    title: "Everything is back",
    text: "Tickets with their numbers, notes and replies, customers, the team and the Knowledge Base.",
  },
];

function formatDate(time) {
  return new Date(time).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function BackupRestore() {
  const {
    tickets,
    customers,
    team,
    answers,
    rules,
    automations,
    settings,
    updateSettings,
    makeBackup,
    restoreBackup,
  } = useData();
  const backup = settings.backup;
  const fileInput = useRef(null);

  const [picked, setPicked] = useState(null); // { name, backup }
  const [pickError, setPickError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [restoredAt, setRestoredAt] = useState(null);

  const current = backupSummary({
    tickets,
    customers,
    team,
    answers,
    rules,
    automations,
  });

  function downloadBackup() {
    const data = makeBackup();
    downloadJson(data, backupFileName(data.exportedAt));
  }

  async function handlePick(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setRestoredAt(null);
    try {
      const { backup: found, error } = checkBackup(await readJsonFile(file));
      if (error) {
        setPickError(error);
        setPicked(null);
        return;
      }
      setPicked({ name: file.name, backup: found });
      setPickError("");
    } catch (err) {
      setPickError(err.message);
      setPicked(null);
    }
  }

  function runRestore() {
    restoreBackup(picked.backup.data);
    setRestoredAt(picked.backup.exportedAt);
    setPicked(null);
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Back up now */}
        <Card title="Back up now">
          <div className="-mt-2 flex flex-col gap-4">
            <p className="text-sm text-muted">
              Saves everything into one JSON file, with every ID kept exactly as
              it is.
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {current.map((item) => (
                <li
                  key={item.label}
                  className="rounded-lg bg-page px-3 py-2 text-sm"
                >
                  <span className="block text-lg font-semibold">
                    {item.count}
                  </span>
                  <span className="text-xs text-muted">{item.label}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-2 sm:flex sm:items-center">
              <button
                type="button"
                onClick={downloadBackup}
                className={`${primaryButton} flex items-center justify-center gap-2`}
              >
                <Download className="h-4 w-4" />
                Download backup
              </button>
              <span className="text-center text-xs text-muted sm:text-left">
                {backup.lastBackupAt
                  ? `Last backup ${timeAgo(backup.lastBackupAt)}`
                  : "No backup yet"}
              </span>
            </div>
          </div>
        </Card>

        {/* Restore */}
        <Card title="Restore from a backup">
          <div className="-mt-2 flex flex-col gap-4">
            <p className="text-sm text-muted">
              Brings the app back to exactly how it was when the backup was
              made.
            </p>

            {restoredAt && (
              <p className="flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-2.5 text-sm font-medium text-brand">
                <CircleCheck className="h-4 w-4 shrink-0" />
                Restored the backup from {formatDate(restoredAt)}.
              </p>
            )}

            {picked ? (
              <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-3">
                <div className="flex items-start gap-3">
                  <FileJson className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {picked.name}
                    </p>
                    <p className="text-xs text-muted">
                      Made {formatDate(picked.backup.exportedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Pick a different file"
                    onClick={() => setPicked(null)}
                    className="cursor-pointer rounded-lg p-1.5 text-muted transition hover:bg-white hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
                  {backupSummary(picked.backup.data).map((item) => (
                    <li key={item.label}>
                      <span className="font-semibold text-ink">
                        {item.count}
                      </span>{" "}
                      {item.label.toLowerCase()}
                    </li>
                  ))}
                </ul>
                {/* A grid (not flex) wrapper keeps the button full height */}
                <div className="grid">
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className={`${primaryButton} flex items-center justify-center gap-2`}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restore this backup
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid sm:flex">
                <button
                  type="button"
                  onClick={() => fileInput.current.click()}
                  className={`${secondaryButton} flex items-center justify-center gap-2`}
                >
                  <Upload className="h-4 w-4" />
                  Choose a backup file
                </button>
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              onChange={handlePick}
              className="hidden"
            />
            {pickError && (
              <p className="flex items-center gap-2 text-sm text-red-500">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                {pickError}
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Automatic backups */}
      <Card title="Automatic backups">
        <div className="-mt-2 flex flex-col gap-4">
          <p className="text-sm text-muted">
            Choose where backups go and how often. Google Drive and Backblaze
            connect, and the schedule starts running, once the backend is built.
            Your choices are saved now.
          </p>

          <div
            role="radiogroup"
            aria-label="Backup destination"
            className="grid gap-3 md:grid-cols-3"
          >
            {DESTINATIONS.map((d) => {
              const Icon = d.icon;
              const selected = backup.destination === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() =>
                    updateSettings("backup", { destination: d.id })
                  }
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition active:scale-[0.99] ${
                    selected
                      ? "border-brand bg-brand/5"
                      : "border-line hover:border-brand/30 hover:bg-brand/5"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      selected ? "bg-brand text-white" : "bg-page text-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {d.label}
                      {!d.ready && (
                        <span className="rounded bg-page px-1.5 py-0.5 text-[11px] font-normal text-muted">
                          Needs backend
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted">{d.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              How often
              <select
                value={backup.schedule}
                onChange={(e) =>
                  updateSettings("backup", { schedule: e.target.value })
                }
                className={`${inputClass} cursor-pointer`}
              >
                <option value="off">Off</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            <label className={labelClass}>
              Keep
              <select
                value={backup.keep}
                onChange={(e) =>
                  updateSettings("backup", { keep: Number(e.target.value) })
                }
                className={`${inputClass} cursor-pointer`}
              >
                {[7, 14, 30, 90].map((n) => (
                  <option key={n} value={n}>
                    The last {n} backups
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Card>

      {/* Disaster recovery */}
      <Card title="If the website goes down">
        <ol className="-mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {RECOVERY_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
                {i === 0 ? <GitBranch className="h-4 w-4" /> : i + 1}
              </span>
              <span>
                <span className="block text-sm font-medium">{step.title}</span>
                <span className="block text-xs text-muted">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {confirming && (
        <Modal
          title="Restore this backup?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  runRestore();
                  setConfirming(false);
                }}
                className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] sm:flex-none"
              >
                Replace everything
              </button>
            </>
          }
        >
          <p className="flex items-start gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Everything in the app now will be replaced with the backup from{" "}
            {formatDate(picked.backup.exportedAt)}. Anything added since then
            will be gone.
          </p>
          <p className="text-sm text-muted">
            Tip: download a backup of what's here first, just in case.
          </p>
          <div className="grid sm:flex">
            <button
              type="button"
              onClick={downloadBackup}
              className={`${secondaryButton} flex items-center justify-center gap-2`}
            >
              <Download className="h-4 w-4" />
              Download a backup first
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
