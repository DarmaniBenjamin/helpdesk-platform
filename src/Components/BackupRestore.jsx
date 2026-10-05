import { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  TriangleAlert,
  GitBranch,
  FileJson,
  Info,
  X,
  RotateCcw,
  Save,
  LoaderCircle,
} from "lucide-react";
import Card from "./Card";
import OffsiteBackups from "./OffsiteBackups";
import Modal from "./Modal";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { readJsonFile, formatBytes, backupContents } from "./backupUtils";
import { api } from "../api";
import { timeAgo } from "../data";
import useData from "../useData";

const RECOVERY_STEPS = [
  {
    title: "Put the website back",
    text: "Redeploy it from your GitHub repo and set up an empty database (npm run db:migrate, then npm run db:seed).",
  },
  {
    title: "Sign in",
    text: "Sign in as the Super Admin from db:seed, then open Settings and go to Backup & Restore.",
  },
  {
    title: "Restore your latest backup",
    text: "Upload your newest backup file, or under Copies in the cloud, fill in the same storage details and backup password and restore the newest copy (it brings the attached files back too). The Super Admin in the backup takes over, with their own password.",
  },
  {
    title: "Everything is back",
    text: "Tickets with their numbers, notes and replies, customers, the team, the Knowledge Base, rules and automations.",
  },
];

function formatDate(time) {
  return new Date(time).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// "Are you sure?" before restoring. It replaces everything, so the word
// RESTORE has to be typed first.
function ConfirmRestore({ what, contents, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = typed.trim().toUpperCase() === "RESTORE";

  async function handleRestore(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Restore this backup?"
      onClose={busy ? () => {} : onClose}
      onSubmit={handleRestore}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy ? "Restoring…" : "Restore"}
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-line bg-page p-3 text-sm">
        <p className="font-medium">{what}</p>
        {contents && (
          <p className="text-muted">
            Made {formatDate(contents.exportedAt)} ·{" "}
            {contents.items
              .slice(0, 3)
              .map((i) => `${i.count} ${i.label.toLowerCase()}`)
              .join(", ")}
          </p>
        )}
      </div>
      <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Everything in the helpdesk now is <strong>replaced</strong> by this
          backup: tickets, customers, the team, the Knowledge Base, rules,
          automations and settings. Anything added since it was made is lost.
          Everyone else is signed out. <strong>Download a backup first</strong>{" "}
          if you might need what's here now.
        </p>
      </div>
      <label className={labelClass}>
        <span>
          Type <strong>RESTORE</strong> to confirm
        </span>
        <input
          autoFocus
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setError("");
          }}
          placeholder="RESTORE"
          className={inputClass}
        />
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
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
  } = useData();
  const backup = settings.backup;
  const fileInput = useRef(null);

  // Backups saved on the server
  const [saved, setSaved] = useState(null); // null = loading
  const [savedError, setSavedError] = useState("");
  const [saving, setSaving] = useState(false);

  // A backup file picked to restore
  const [picked, setPicked] = useState(null); // { name, file, contents }
  const [pickError, setPickError] = useState("");
  // What's being confirmed: { what, contents, run }
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    api("/backup/saved")
      .then(setSaved)
      .catch((err) => {
        setSaved([]);
        setSavedError(err.message);
      });
  }, []);

  const current = [
    { label: "Tickets", count: tickets.length },
    { label: "Customers", count: customers.length },
    {
      label: "Team members",
      count: team.filter((m) => m.role !== "customer").length,
    },
    { label: "Knowledge Base answers", count: answers.length },
    { label: "Assignment rules", count: rules.length },
    { label: "Automations", count: automations.length },
  ];

  async function saveNow() {
    setSaving(true);
    setSavedError("");
    try {
      const result = await api("/backup/run", { method: "POST" });
      setSaved(result.saved);
    } catch (err) {
      setSavedError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePick(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPicked(null);
    setPickError("");
    try {
      const json = await readJsonFile(file);
      const contents = backupContents(json);
      if (!contents) {
        setPickError(
          json?.data
            ? "This backup was made before restoring was possible, so it can't be restored. Download a new backup instead."
            : "This isn't a helpdesk backup file.",
        );
        return;
      }
      setPicked({ name: file.name, file, contents });
    } catch (err) {
      setPickError(err.message);
    }
  }

  // After a restore, everything is different: load the app again
  function afterRestore() {
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Back up now */}
        <Card title="Back up now">
          <div className="-mt-2 flex flex-col gap-4">
            <p className="text-sm text-muted">
              One file with everything in the database, every ID kept exactly as
              it is, including the team's sign-ins. Keep it somewhere safe.
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
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
              <a
                href="/api/backup/download"
                download
                className={`${primaryButton} flex items-center justify-center gap-2`}
              >
                <Download className="h-4 w-4" />
                Download backup
              </a>
              <button
                type="button"
                onClick={saveNow}
                disabled={saving}
                className={`${secondaryButton} flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70`}
              >
                {saving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save on the server
              </button>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Attached files (photos, PDFs…) aren't in the backup file: they're
              kept in the server's uploads folder. Copies in the cloud (below)
              include them.
            </p>
          </div>
        </Card>

        {/* Restore from a file */}
        <Card title="Restore from a backup file">
          <div className="-mt-2 flex flex-col gap-4">
            <p className="text-sm text-muted">
              Brings the helpdesk back to exactly how it was when the backup was
              made. You'll check what's inside before anything happens.
            </p>

            {picked ? (
              <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-3">
                <div className="flex items-start gap-3">
                  <FileJson className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {picked.name}
                    </p>
                    <p className="text-xs text-muted">
                      Made {formatDate(picked.contents.exportedAt)} ·{" "}
                      {formatBytes(picked.file.size)}
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
                  {picked.contents.items.map((item) => (
                    <li key={item.label}>
                      <span className="font-semibold text-ink">
                        {item.count}
                      </span>{" "}
                      {item.label.toLowerCase()}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    setConfirming({
                      what: picked.name,
                      contents: picked.contents,
                      // The file itself is sent, as it is
                      run: () =>
                        api("/backup/restore", {
                          method: "POST",
                          raw: picked.file,
                        }),
                    })
                  }
                  className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97]"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restore this backup
                </button>
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
              <p className="flex items-start gap-2 text-sm text-red-500">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
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
            The server checks every hour and saves a backup when one is due,
            keeping only the newest ones.{" "}
            {backup.lastBackupAt
              ? `Last backup ${timeAgo(backup.lastBackupAt)}.`
              : "No backup yet."}
          </p>

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

          {/* The backups saved on the server */}
          <div>
            <p className="mb-2 text-sm font-medium">Saved on the server</p>
            {saved === null ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading…
              </p>
            ) : saved.length === 0 ? (
              <p className="rounded-lg bg-page px-3 py-4 text-center text-sm text-muted">
                None yet. The first one is saved within the hour, or press "Save
                on the server" above.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {saved.map((b) => (
                  <li
                    key={b.name}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {formatDate(b.at)}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {b.name} · {formatBytes(b.size)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`/api/backup/saved/${encodeURIComponent(b.name)}`}
                        download
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-sm transition hover:border-brand/40 hover:text-brand sm:flex-none"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirming({
                            what: `The backup from ${formatDate(b.at)}`,
                            contents: null,
                            run: () =>
                              api("/backup/restore-saved", {
                                method: "POST",
                                body: { name: b.name },
                              }),
                          })
                        }
                        className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm text-red-500 transition hover:bg-red-50 sm:flex-none"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {savedError && (
              <p className="mt-2 text-sm text-red-500">{savedError}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Copies in the cloud (OffsiteBackups.jsx) */}
      <OffsiteBackups />

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
        <ConfirmRestore
          what={confirming.what}
          contents={confirming.contents}
          onConfirm={async () => {
            await confirming.run();
            afterRestore();
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
