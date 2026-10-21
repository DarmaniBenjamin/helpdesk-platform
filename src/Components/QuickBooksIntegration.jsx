import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ExternalLink, Receipt, Unplug } from "lucide-react";
import Droplets from "./Droplets";
import { Alert, CopyRow, OnOffPill, Step } from "./integrationParts";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { api } from "../api";

// Integrations → QuickBooks (server/src/quickbooks.js): tickets marked
// "Bill in QuickBooks" get a draft invoice there when they're closed, for
// someone to finish and send from QuickBooks.
export default function QuickBooksIntegration() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(null); // { clientId, clientSecret, environment, itemId }
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [params, setParams] = useSearchParams();

  // Back from Intuit: ?quickbooks=connected, or ?quickbooks=error&why=…
  const returned = params.get("quickbooks");
  const returnedWhy = params.get("why");

  useEffect(() => {
    api("/quickbooks")
      .then((data) => {
        setInfo(data);
        setForm({
          clientId: data.clientId,
          clientSecret: "",
          environment: data.environment,
          itemId: data.itemId,
        });
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  // Connected: the products/services, to pick the one for the draft line
  useEffect(() => {
    if (!info?.connected) return;
    api("/quickbooks/items")
      .then(setItems)
      .catch(() => setItems([]));
  }, [info?.connected]);

  // Scroll here when coming back from Intuit
  useEffect(() => {
    if (returned)
      document
        .getElementById("quickbooks")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [returned]);

  function clearReturned() {
    const next = new URLSearchParams(params);
    next.delete("quickbooks");
    next.delete("why");
    setParams(next, { replace: true });
  }

  async function saveKeys(e) {
    e.preventDefault();
    setBusy("save");
    setError("");
    setSaved("");
    try {
      const data = await api("/quickbooks/app", { method: "PUT", body: form });
      setInfo(data);
      setForm((f) => ({ ...f, clientSecret: "" }));
      setSaved("Saved.");
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  async function connect() {
    setBusy("connect");
    setError("");
    try {
      const { url } = await api("/quickbooks/connect", { method: "POST" });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      setInfo(await api("/quickbooks", { method: "DELETE" }));
      setItems(null);
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  async function saveItem(itemId) {
    setForm((f) => ({ ...f, itemId }));
    setError("");
    try {
      setInfo(
        await api("/quickbooks/app", {
          method: "PUT",
          body: { ...form, clientSecret: "", itemId },
        }),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  const keysChanged =
    form &&
    info &&
    (form.clientId !== info.clientId ||
      form.environment !== info.environment ||
      form.clientSecret);

  return (
    <section
      id="quickbooks"
      className="flex scroll-mt-20 flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
            <Receipt className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">QuickBooks Online</h2>
            <p className="text-sm text-muted">
              Tick "Bill in QuickBooks" when adding a ticket (or later, on the
              ticket). When it's closed, a draft invoice is made in QuickBooks
              for that customer, with the ticket number, title and fix. Nothing
              is sent to the customer: open it in QuickBooks, add the hours,
              parts and prices, and send it from there.
            </p>
          </div>
        </div>
        <OnOffPill on={Boolean(info?.connected)} />
      </div>

      {loadError && <Alert>{loadError}</Alert>}
      {!info && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Droplets className="h-4 w-4" />
          Loading…
        </p>
      )}

      {returned === "connected" && info?.connected && (
        <Alert tone="ok">
          Connected to {info.companyName || "QuickBooks"}.{" "}
          <button
            type="button"
            onClick={clearReturned}
            className="cursor-pointer underline"
          >
            OK
          </button>
        </Alert>
      )}
      {returned === "error" && (
        <Alert>
          QuickBooks didn't connect: {returnedWhy || "try again"}.{" "}
          <button
            type="button"
            onClick={clearReturned}
            className="cursor-pointer underline"
          >
            OK
          </button>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      {info?.connected && (
        <div className="flex flex-col gap-4 rounded-lg border border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {info.companyName || "Your QuickBooks company"}
              </p>
              <p className="text-sm text-muted">
                {info.environment === "production"
                  ? "The real company"
                  : "Sandbox (a test company)"}
                {info.connectedBy ? `, connected by ${info.connectedBy}` : ""}
                {info.connectedAt
                  ? ` on ${new Date(info.connectedAt).toLocaleDateString()}`
                  : ""}
                .
              </p>
            </div>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy === "disconnect"}
              className={`${secondaryButton} flex basis-auto items-center justify-center gap-2 text-red-600 hover:border-red-200 hover:text-red-600`}
            >
              <Unplug className="h-4 w-4" />
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          <label className={labelClass}>
            Product/service on the draft line
            <select
              value={form?.itemId ?? ""}
              onChange={(e) => saveItem(e.target.value)}
              disabled={!items}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">
                Pick by itself ("Services", or the first service)
              </option>
              {(items ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted">
              The draft has one line at $0.00 with this. Change it or add more
              lines in QuickBooks before sending.
            </span>
          </label>
        </div>
      )}

      {info && form && (
        <details
          className="group rounded-lg border border-line"
          open={!info.connected}
        >
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
            {info.connected
              ? "The QuickBooks app (Client ID and Secret)"
              : "Set it up (about 10 minutes, once)"}
          </summary>
          <form
            onSubmit={saveKeys}
            className="flex flex-col gap-4 border-t border-line p-4"
          >
            <ol className="flex flex-col gap-4">
              <Step n={1}>
                <p>
                  Sign in at{" "}
                  <a
                    href="https://developer.intuit.com/app/developer/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                  >
                    developer.intuit.com
                    <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  with the Intuit account that owns your QuickBooks. Choose{" "}
                  <strong>
                    Create an app → QuickBooks Online and Payments
                  </strong>
                  , name it (e.g. "Uplink"), and tick the{" "}
                  <strong>Accounting</strong> scope.
                </p>
              </Step>
              <Step n={2}>
                <p>
                  In the app's <strong>Keys &amp; credentials</strong>, add this
                  as a <strong>Redirect URI</strong> (for Development and,
                  later, Production):
                </p>
                <CopyRow value={info.redirectUri} label="address" />
                {!info.redirectUri.startsWith("https://") &&
                  !/^http:\/\/(localhost|127\.)/.test(info.redirectUri) && (
                    <p className="text-xs text-amber-700">
                      Intuit needs an https address: open Uplink on its https
                      address and come back here.
                    </p>
                  )}
              </Step>
              <Step n={3}>
                <p>
                  Copy the <strong>Client ID</strong> and{" "}
                  <strong>Client Secret</strong> from the same page into here.
                  Development keys connect a sandbox (test) company; Production
                  keys, once Intuit approves the app, connect the real one.
                </p>
              </Step>
            </ol>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Client ID
                <input
                  value={form.clientId}
                  onChange={(e) =>
                    setForm({ ...form, clientId: e.target.value.trim() })
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className={`${inputClass} font-mono`}
                />
              </label>
              <label className={labelClass}>
                Client Secret
                <input
                  type="password"
                  value={form.clientSecret}
                  onChange={(e) =>
                    setForm({ ...form, clientSecret: e.target.value.trim() })
                  }
                  placeholder={info.hasSecret ? "Saved (type to change)" : ""}
                  autoComplete="new-password"
                  className={`${inputClass} font-mono`}
                />
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Which company</span>
              <div className="flex flex-wrap gap-2">
                {[
                  ["sandbox", "Sandbox (testing)"],
                  ["production", "Production (the real company)"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm({ ...form, environment: value })}
                    className={`h-9 cursor-pointer rounded-full border px-4 text-sm transition active:scale-[0.97] ${
                      form.environment === value
                        ? "border-brand bg-brand/10 font-medium text-brand"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {info.connected && keysChanged && (
                <p className="text-xs text-amber-700">
                  Saving new keys or another company disconnects the current
                  one: connect again afterwards.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={busy === "save" || !form.clientId}
                className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {busy === "save" ? "Saving…" : "Save the keys"}
              </button>
              {saved && <span className="text-sm text-brand">{saved}</span>}
            </div>

            <ol className="flex flex-col gap-4" start={4}>
              <Step n={4}>
                <p>
                  <strong>Connect to QuickBooks</strong>: Intuit asks you to
                  sign in and pick the company. From then on, every ticket
                  marked "Bill in QuickBooks" gets its draft invoice when it's
                  closed.
                </p>
              </Step>
            </ol>
            {!info.connected && (
              <div className="flex">
                <button
                  type="button"
                  onClick={connect}
                  disabled={
                    busy === "connect" ||
                    !info.clientId ||
                    !info.hasSecret ||
                    keysChanged
                  }
                  className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {busy === "connect"
                    ? "Opening QuickBooks…"
                    : "Connect to QuickBooks"}
                </button>
              </div>
            )}
            {!info.connected && keysChanged && (
              <p className="text-xs text-muted">Save the keys first.</p>
            )}
          </form>
        </details>
      )}
    </section>
  );
}
