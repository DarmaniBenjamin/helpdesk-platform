import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Check,
  CircleCheck,
  Copy,
  KeyRound,
  Link2,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Modal from "./Modal";
import CustomerPicker from "./CustomerPicker";
import Droplets from "./Droplets";
import { copyText } from "./copyText";
import { inputClass, labelClass, secondaryButton } from "./formStyles";
import { api } from "../api";
import { timeAgo } from "../data";
import useData from "../useData";

// Integrations → Backup alerts (server/src/backupAlerts.js).
// The backup gateway sends its alerts here (malware found, a computer
// gone quiet, off-site copies failing, its disk filling up...), and each
// problem becomes one alert on the Alerts page (Pages/Alerts.jsx). Alerts
// about the same problem are counted on it, and when the problem clears it
// resolves itself. Critical ones also make a ticket by themselves.
//
// Each client on a gateway is matched to a customer here, once. Until
// then its alerts go to a customer made for it, marked on the list.

function Alert({ tone = "error", children }) {
  const styles = {
    error: "bg-red-50 text-red-600",
    warn: "bg-amber-50 text-amber-700",
    ok: "bg-brand/10 text-brand",
  };
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg p-3 text-sm ${styles[tone]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 wrap-break-word">{children}</div>
    </div>
  );
}

function CopyRow({ value, label, mono = true }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code
        className={`min-w-0 flex-1 break-all rounded-lg border border-line bg-page px-3 py-2.5 text-sm ${mono ? "font-mono" : ""}`}
      >
        {value}
      </code>
      <div className="flex">
        <button
          type="button"
          onClick={async () => {
            if (await copyText(value, `Copy the ${label}:`)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className={`${secondaryButton} flex items-center justify-center gap-2`}
        >
          {copied ? (
            <Check className="h-4 w-4 text-brand" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copied" : `Copy ${label}`}
        </button>
      </div>
    </div>
  );
}

// Link one gateway client to one of your customers
function LinkModal({ client, onClose, onSaved }) {
  const { customers } = useData();
  // The customer made for these alerts isn't offered as a choice
  const choices = customers.filter(
    (c) => !(client.madeCustomer && c.id === client.customer?.id),
  );
  const [picked, setPicked] = useState(
    client.madeCustomer
      ? null
      : (customers.find((c) => c.id === client.customer?.id) ?? null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      title={`Who is ${client.client || "this gateway"}?`}
      onClose={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!picked) return setError("Pick a customer.");
        setSaving(true);
        setError("");
        try {
          onSaved(
            await api(`/integrations/backup/clients/${client.id}`, {
              method: "POST",
              body: { customerId: picked.id },
            }),
          );
          onClose();
        } catch (err) {
          setError(err.message);
          setSaving(false);
        }
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn-glass min-h-8.5 sm:min-h-7 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition active:scale-[0.97] disabled:opacity-60 sm:flex-none py-0.5 leading-5 text-center sm:text-[13px] basis-auto"
          >
            {saving ? "Saving…" : "Link"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Alerts for{" "}
          <strong className="text-ink">
            {client.client || `the gateway "${client.gateway}" itself`}
          </strong>{" "}
          will be for this customer.
          {client.alerts + client.tickets > 0 &&
            ` Its alerts so far, and their tickets, move over too.`}
          {client.madeCustomer &&
            ` "${client.customer?.name}", made for these alerts, is removed once nothing else uses it.`}
        </p>
        <CustomerPicker
          customers={choices}
          selected={picked}
          onSelect={setPicked}
          emptyText="No customers match. Add them on the Customers page first."
        />
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

export default function BackupAlerts() {
  const { departments } = useData();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  // The secret, only right after it's made (it can't be shown again)
  const [secret, setSecret] = useState("");
  const [confirmNewSecret, setConfirmNewSecret] = useState(false);
  const [linking, setLinking] = useState(null);
  const address = `${window.location.origin}/api/integrations/backup/webhook`;

  useEffect(() => {
    api("/integrations/backup")
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  }, []);

  async function run(what, request) {
    setBusy(what);
    setError("");
    try {
      const result = await request();
      if (result.secret) setSecret(result.secret);
      setInfo(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const save = (what, body) =>
    run(what, () => api("/integrations/backup", { method: "POST", body }));

  const unlinked = info?.clients.filter((c) => c.madeCustomer).length ?? 0;

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Backup alerts</h2>
            <p className="text-sm text-muted">
              Problems your backup gateways find go to the Alerts page: malware,
              computers that stop checking in, failing off-site copies, a disk
              filling up. More alerts about the same problem are counted on it,
              and it resolves itself when the problem clears. Critical ones also
              make a ticket by themselves.
            </p>
          </div>
        </div>
        {info?.enabled ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            On
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted">
            Off
          </span>
        )}
      </div>

      {loadError && <Alert>{loadError}</Alert>}
      {!info && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" />
          Loading…
        </p>
      )}

      {info && !info.enabled && (
        <div className="flex">
          <button
            type="button"
            disabled={busy === "enable"}
            onClick={() => save("enable", { enabled: true })}
            className="btn-glass min-h-8.5 sm:min-h-7 cursor-pointer rounded-md px-3 text-sm font-medium transition active:scale-[0.97] disabled:opacity-60 py-0.5 leading-5 text-center sm:text-[13px]"
          >
            {busy === "enable" ? "Turning on…" : "Turn on backup alerts"}
          </button>
        </div>
      )}

      {info?.enabled && (
        <>
          {/* Connecting a gateway: these are steps, in order */}
          <ol className="flex flex-col gap-4">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page text-xs font-semibold">
                1
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm">
                  On the backup gateway, open <strong>Alerts</strong>, add a{" "}
                  <strong>Webhook</strong> channel and pick{" "}
                  <strong>JSON, for Uplink or your own systems</strong>. Paste
                  this into its <strong>Webhook address</strong>:
                </p>
                <CopyRow value={address} label="address" />
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page text-xs font-semibold">
                2
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {secret ? (
                  <>
                    <p className="text-sm">
                      Paste this into its <strong>Signing secret</strong>. It's
                      only shown now: copy it before leaving this page.
                    </p>
                    <CopyRow value={secret} label="secret" />
                  </>
                ) : (
                  <p className="text-sm">
                    Paste the secret into its <strong>Signing secret</strong>.
                    It was shown once, when this was turned on. Lost it? Make a
                    new one; gateways using the old one stop getting through
                    until they have the new one.
                  </p>
                )}
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => setConfirmNewSecret(true)}
                    className={`${secondaryButton} flex items-center justify-center gap-2`}
                  >
                    <KeyRound className="h-4 w-4" />
                    Make a new secret
                  </button>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page text-xs font-semibold">
                3
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm">
                  Press <strong>Send test</strong> on the gateway, then save it.
                </p>
                <p className="text-sm text-muted">
                  {info.lastTestAt
                    ? `Test received from "${info.gateway}" ${timeAgo(info.lastTestAt)}.`
                    : "No test received yet."}
                  {info.lastAt &&
                    info.lastAt !== info.lastTestAt &&
                    ` Last alert ${timeAgo(info.lastAt)}.`}
                </p>
              </div>
            </li>
          </ol>

          <label className={labelClass}>
            <span>
              Team{" "}
              <span className="font-normal text-muted">
                (told about high and critical alerts, and gets the tickets made from them)
              </span>
            </span>
            <select
              value={info.departmentId ?? ""}
              disabled={busy === "team"}
              onChange={(e) =>
                save("team", { departmentId: e.target.value || null })
              }
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">No team, the Inbox</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          {/* The clients the gateways have sent alerts about */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium">Clients</p>
              <p className="text-sm text-muted">
                {info.clients.length === 0
                  ? "Each client appears here with its first alert. Then link it to one of your customers."
                  : unlinked > 0
                    ? `${unlinked} not linked yet: their alerts go to a customer made for them until you link them.`
                    : "Every client is linked to a customer."}
              </p>
            </div>
            {info.clients.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {info.clients.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.client || "The gateway itself"}
                        <span className="font-normal text-muted">
                          {" "}
                          on {c.gateway}
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        {c.madeCustomer ? (
                          <span className="text-amber-700">
                            Not linked: going to "{c.customer?.name}"
                          </span>
                        ) : c.customer ? (
                          <>
                            Linked to{" "}
                            <Link
                              to={`/customers/${c.customer.id}`}
                              className="text-brand hover:underline"
                            >
                              {c.customer.name}
                            </Link>
                          </>
                        ) : (
                          "Its customer was deleted: link it again"
                        )}
                        {c.openAlerts > 0 &&
                          `, ${c.openAlerts} open alert${c.openAlerts === 1 ? "" : "s"}`}
                        {`, last alert ${timeAgo(c.lastSeenAt)}`}
                      </p>
                    </div>
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() => setLinking(c)}
                        className={`${secondaryButton} flex items-center justify-center gap-2`}
                      >
                        <Link2 className="h-4 w-4" />
                        {c.madeCustomer || !c.customer
                          ? "Link to customer"
                          : "Change"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex">
            <button
              type="button"
              disabled={busy === "disable"}
              onClick={() => save("disable", { enabled: false })}
              className="cursor-pointer text-sm text-muted underline hover:text-ink"
            >
              Turn off backup alerts
            </button>
          </div>
        </>
      )}

      {error && <Alert>{error}</Alert>}

      {confirmNewSecret && (
        <Modal
          title="Make a new secret?"
          onClose={() => setConfirmNewSecret(false)}
          onSubmit={async (e) => {
            e.preventDefault();
            await run("secret", () =>
              api("/integrations/backup/secret", { method: "POST" }),
            );
            setConfirmNewSecret(false);
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmNewSecret(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-glass btn-glass-red min-h-8.5 sm:min-h-7 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition sm:flex-none py-0.5 leading-5 text-center sm:text-[13px] basis-auto"
              >
                Make a new secret
              </button>
            </>
          }
        >
          <p className="text-sm">
            The old secret stops working straight away. Alerts from gateways
            that still use it are turned away until you paste the new one into
            them.
          </p>
        </Modal>
      )}

      {linking && (
        <LinkModal
          client={linking}
          onClose={() => setLinking(null)}
          onSaved={setInfo}
        />
      )}
    </section>
  );
}
