import { useEffect, useState } from "react";
import {
  CircleCheck,
  Cloud,
  CloudUpload,
  KeyRound,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import Card from "./Card";
import Modal from "./Modal";
import PasswordInput from "./PasswordInput";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { formatBytes } from "./backupUtils";
import { api } from "../api";
import { timeAgo } from "../data";
import Droplets from "./Droplets";

// Settings → Backup & Restore → Copies in the cloud. Every backup saved
// on the server is also locked with a backup password and copied to
// cloud storage (Backblaze B2, Cloudflare R2, Amazon S3...), with the
// attached files and the server's secret key, so everything can be put
// back on a new server (server/src/offsite.js).

// How to get the details, for each kind of storage
const GUIDES = {
  b2: {
    endpointHint: "e.g. https://s3.us-east-005.backblazeb2.com",
    steps: [
      "Sign up at backblaze.com (B2 Cloud Storage, 10 GB free).",
      "Buckets → Create a Bucket: a unique name, Private. Its Endpoint is shown on the bucket (add https:// in front).",
      "Application Keys → Add a New Application Key: allow access to that bucket only, Read and Write.",
      "Copy the keyID and applicationKey into Key ID and Secret key here (the key is only shown once).",
    ],
  },
  r2: {
    endpointHint: "https://<account id>.r2.cloudflarestorage.com",
    steps: [
      "In the Cloudflare dashboard, open R2 (10 GB free) and create a bucket.",
      "R2 → Manage API tokens → Create API token: Object Read & Write, for that bucket.",
      "Copy the Access Key ID, Secret Access Key, and the S3 endpoint (https://…r2.cloudflarestorage.com) here.",
    ],
  },
  s3: {
    endpointHint: "Leave empty for Amazon S3",
    steps: [
      "Create a private S3 bucket, and note its region (e.g. us-east-1).",
      "In IAM, create a user with access to that bucket only, and an access key for it.",
      "Copy the access key ID and secret access key here.",
    ],
  },
  other: {
    endpointHint: "https://…",
    steps: [
      "Any storage that works with the S3 API (Wasabi, MinIO, DigitalOcean Spaces...).",
      "Fill in its endpoint, region, bucket, and an access key for that bucket.",
    ],
  },
};

const emptyForm = {
  provider: "b2",
  endpoint: "",
  region: "",
  bucket: "",
  folder: "uplink-backups",
  keyId: "",
  secretKey: "",
  password: "",
  confirm: "",
};

function formatDate(time) {
  return new Date(time).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// The settings form: where the copies go, and the backup password
function Settings({ config, providers, onSaved, onCancel }) {
  const [form, setForm] = useState(
    config.enabled
      ? { ...emptyForm, ...config, secretKey: "", password: "", confirm: "" }
      : emptyForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (changes) => {
    setForm((f) => ({ ...f, ...changes }));
    setError("");
  };
  const guide = GUIDES[form.provider] ?? GUIDES.other;
  const newPassword = !config.enabled || form.password;

  async function save(e) {
    e.preventDefault();
    if (newPassword && form.password !== form.confirm) {
      setError("The two backup passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Everything but the "type it again" box
      const body = { ...form };
      delete body.confirm;
      onSaved(await api("/backup/offsite", { method: "PUT", body }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <label className={labelClass}>
        Storage
        <select
          value={form.provider}
          onChange={(e) => set({ provider: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          {Object.entries(providers).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        {form.provider !== "s3" && (
          <label className={`${labelClass} sm:col-span-2`}>
            Endpoint
            <input
              value={form.endpoint}
              onChange={(e) => set({ endpoint: e.target.value.trim() })}
              placeholder={guide.endpointHint}
              autoCapitalize="none"
              spellCheck="false"
              className={inputClass}
            />
          </label>
        )}
        {(form.provider === "s3" || form.provider === "other") && (
          <label className={labelClass}>
            Region
            <input
              value={form.region}
              onChange={(e) => set({ region: e.target.value.trim() })}
              placeholder="e.g. us-east-1"
              autoCapitalize="none"
              className={inputClass}
            />
          </label>
        )}
        <label className={labelClass}>
          Bucket
          <input
            value={form.bucket}
            onChange={(e) => set({ bucket: e.target.value.trim() })}
            autoCapitalize="none"
            spellCheck="false"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Folder in the bucket
          <input
            value={form.folder}
            onChange={(e) => set({ folder: e.target.value.trim() })}
            autoCapitalize="none"
            spellCheck="false"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Key ID
          <input
            value={form.keyId}
            onChange={(e) => set({ keyId: e.target.value.trim() })}
            autoCapitalize="none"
            spellCheck="false"
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Secret key
          <input
            type="password"
            value={form.secretKey}
            onChange={(e) => set({ secretKey: e.target.value.trim() })}
            placeholder={
              config.enabled ? "Saved. Paste a new one to change it" : ""
            }
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
      </div>

      {/* The backup password */}
      <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="flex items-start gap-2 text-sm text-amber-700">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Backup password:</strong> each copy is locked with it before
            it leaves the server, so the storage company can't read it. Save it
            in a password manager: without it, the copies can't be opened.
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            {config.enabled
              ? "New backup password (optional)"
              : "Backup password"}
            <PasswordInput
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              autoComplete="new-password"
              placeholder={
                config.enabled
                  ? "Saved. Leave empty to keep it"
                  : "At least 10 characters"
              }
            />
          </label>
          {newPassword && (
            <label className={labelClass}>
              Type it again
              <PasswordInput
                value={form.confirm}
                onChange={(e) => set({ confirm: e.target.value })}
                autoComplete="new-password"
              />
            </label>
          )}
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 text-sm text-red-500">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className={`${primaryButton} flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70`}
        >
          {busy && <Droplets className="h-4 w-4" />}
          {busy ? "Checking…" : "Save and check"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// "Are you sure?" before restoring a copy from the cloud
function ConfirmRestore({ copy, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore(e) {
    e.preventDefault();
    if (typed !== "RESTORE" || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/backup/offsite/restore", {
        method: "POST",
        body: { name: copy.name },
      });
      window.location.reload(); // everything is different now
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Restore this copy?"
      onClose={busy ? () => {} : onClose}
      onSubmit={restore}
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
            disabled={typed !== "RESTORE" || busy}
            className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {busy && <Droplets className="h-4 w-4" />}
            {busy ? "Restoring…" : "Restore"}
          </button>
        </>
      }
    >
      <p className="text-sm">
        Everything in the helpdesk is replaced with the copy from{" "}
        <strong>{formatDate(copy.at)}</strong>: tickets, customers, the team,
        settings and attached files (any this server doesn't have are
        downloaded). Anything newer than that is lost. Everyone else is signed
        out.
      </p>
      <label className={labelClass}>
        <span>
          Type <strong className="font-mono">RESTORE</strong> to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          className={inputClass}
        />
      </label>
      {busy && (
        <p className="text-sm text-muted">
          Downloading and unlocking the copy. This can take a few minutes with
          lots of attached files.
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
}

export default function OffsiteBackups() {
  const [state, setState] = useState(null); // { config, providers }
  const [copies, setCopies] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null); // { tone, text }
  const [restoring, setRestoring] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api("/backup/offsite")
      .then((data) => {
        setState(data);
        if (data.config.enabled)
          api("/backup/offsite/copies")
            .then(setCopies)
            .catch((err) => {
              setCopies([]);
              setMessage({ tone: "error", text: err.message });
            });
      })
      .catch((err) => setMessage({ tone: "error", text: err.message }));
  }, []);

  async function copyNow() {
    setBusy("copy");
    setMessage(null);
    try {
      const result = await api("/backup/offsite/send", { method: "POST" });
      setState((s) => ({ ...s, config: result.config }));
      setCopies(result.copies);
      setMessage({ tone: "ok", text: "A fresh copy is in the cloud." });
    } catch (err) {
      setMessage({ tone: "error", text: err.message });
    }
    setBusy("");
  }

  async function stop() {
    if (
      !window.confirm(
        "Stop copying backups to the cloud? The copies already there stay.",
      )
    )
      return;
    setBusy("stop");
    try {
      setState(await api("/backup/offsite", { method: "DELETE" }));
      setCopies(null);
      setMessage(null);
    } catch (err) {
      setMessage({ tone: "error", text: err.message });
    }
    setBusy("");
  }

  if (!state)
    return (
      <Card title="Copies in the cloud">
        {message ? (
          <p className="text-sm text-red-500">{message.text}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Droplets className="h-4 w-4" />
            Loading…
          </p>
        )}
      </Card>
    );

  const { config, providers } = state;

  return (
    <Card title="Copies in the cloud">
      <div className="-mt-2 flex flex-col gap-4">
        <p className="text-sm text-muted">
          If this server is ever lost, the backups on it go too. With this on, a
          copy of everything is locked with your backup password and sent to
          cloud storage within 10 minutes of any change, and each attached file
          once. Every copy from the last 2 days is kept, then one a day for a
          month, then one a week for 3 months.
        </p>

        {config.enabled && !editing ? (
          <>
            <div
              className={`flex items-start gap-3 rounded-lg p-3 text-sm ${
                config.lastError
                  ? "bg-red-50 text-red-600"
                  : "bg-brand/10 text-brand"
              }`}
            >
              {config.lastError ? (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <p className="min-w-0 wrap-break-word">
                Copies go to <strong>{config.bucket}</strong>
                {config.folder ? `/${config.folder}` : ""} (
                {providers[config.provider]?.label ?? "S3"}).{" "}
                {config.lastError
                  ? `The last copy didn't work: ${config.lastError}`
                  : config.lastCopyAt
                    ? `Last copy ${timeAgo(config.lastCopyAt)}, with ${config.filesInCloud.toLocaleString()} attached file${config.filesInCloud === 1 ? "" : "s"} in the cloud.`
                    : "No copy yet: the next change makes one, or press Copy now."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyNow}
                disabled={Boolean(busy)}
                className={`${primaryButton} flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70`}
              >
                {busy === "copy" ? (
                  <Droplets className="h-4 w-4" />
                ) : (
                  <CloudUpload className="h-4 w-4" />
                )}
                {busy === "copy" ? "Copying…" : "Copy now"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={secondaryButton}
              >
                Change settings
              </button>
              <button
                type="button"
                onClick={stop}
                disabled={Boolean(busy)}
                className="h-11 cursor-pointer rounded-lg border border-line px-4 text-sm text-red-500 transition hover:border-red-300 hover:bg-red-50"
              >
                Stop copying
              </button>
            </div>

            {message && (
              <p
                className={`text-sm ${message.tone === "ok" ? "text-brand" : "text-red-500"}`}
              >
                {message.text}
              </p>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">In the cloud</p>
              {copies === null ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Droplets className="h-4 w-4" />
                  Loading…
                </p>
              ) : copies.length === 0 ? (
                <p className="rounded-lg bg-page px-3 py-4 text-center text-sm text-muted">
                  None yet.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {(showAll ? copies : copies.slice(0, 10)).map((c) => (
                    <li
                      key={c.name}
                      className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Cloud className="h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {formatDate(c.at)}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {formatBytes(c.size)}, locked
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRestoring(c)}
                        className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm text-red-500 transition hover:bg-red-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {copies?.length > 10 && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-2 cursor-pointer text-sm text-brand hover:underline"
                >
                  Show all {copies.length} versions
                </button>
              )}
            </div>
          </>
        ) : (
          <Settings
            config={config}
            providers={providers}
            onSaved={(data) => {
              setState(data);
              setEditing(false);
              setMessage({
                tone: "ok",
                text: "Saved, and the storage accepted the details. Press Copy now for the first copy.",
              });
              api("/backup/offsite/copies")
                .then(setCopies)
                .catch(() => {});
            }}
            onCancel={config.enabled ? () => setEditing(false) : null}
          />
        )}
      </div>

      {restoring && (
        <ConfirmRestore copy={restoring} onClose={() => setRestoring(null)} />
      )}
    </Card>
  );
}
