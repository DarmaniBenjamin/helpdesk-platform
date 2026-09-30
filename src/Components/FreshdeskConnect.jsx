import { useRef, useState } from "react";
import {
  CircleCheck,
  CloudDownload,
  Eye,
  EyeOff,
  Link2,
  TriangleAlert,
} from "lucide-react";
import Card from "./Card";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import { testConnection, fetchEverything } from "./freshdeskApi";
import useData from "../useData";

// How much to get. Start with one ticket to check everything comes over
// the way you want, then get the rest.
const AMOUNTS = [
  { id: "1", label: "Just the newest ticket (a test)", max: 1 },
  { id: "50", label: "The newest 50 tickets", max: 50 },
  { id: "500", label: "The newest 500 tickets", max: 500 },
  { id: "all", label: "Everything", max: Infinity },
];

// Connect with the address + API key, then pull the data.
// `onFetched(data, label)` gets { tickets, contacts, companies }.
export default function FreshdeskConnect({ onFetched }) {
  const { settings, updateSettings } = useData();
  const domain = settings.freshdesk.domain;

  // The key only lives here while the page is open. It's never saved.
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [account, setAccount] = useState(null); // who the key belongs to
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [amount, setAmount] = useState("1");
  const [withConversations, setWithConversations] = useState(true);
  const [progress, setProgress] = useState(null);
  const cancelRef = useRef(null);

  const connection = { domain, apiKey: apiKey.trim() };
  const max = AMOUNTS.find((a) => a.id === amount).max;

  async function connect(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setAccount(await testConnection(connection));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    setAccount(null);
    setApiKey("");
    setError("");
  }

  async function fetchData() {
    const controller = new AbortController();
    cancelRef.current = controller;
    setError("");
    setProgress({ message: "Starting…" });
    try {
      const data = await fetchEverything(connection, {
        maxTickets: max,
        withConversations,
        signal: controller.signal,
        onProgress: setProgress,
      });
      onFetched(data, `${domain}.freshdesk.com`);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setProgress(null);
      cancelRef.current = null;
    }
  }

  return (
    <Card title="Connect to Freshdesk">
      <form onSubmit={connect} className="-mt-2 flex flex-col gap-4">
        <p className="text-sm text-muted">
          Reads your tickets, contacts and companies. Nothing in Freshdesk is
          changed.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Freshdesk address
            <div className="flex items-center rounded-lg border border-line bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
              <input
                required
                disabled={Boolean(account)}
                value={domain}
                onChange={(e) =>
                  updateSettings("freshdesk", {
                    domain: e.target.value.trim().toLowerCase(),
                  })
                }
                placeholder="yourcompany"
                autoComplete="off"
                className="h-11 w-full min-w-0 rounded-l-lg bg-transparent px-3 text-base placeholder:text-muted focus:outline-none disabled:text-muted sm:text-sm"
              />
              <span className="shrink-0 pr-3 text-sm font-normal text-muted">
                .freshdesk.com
              </span>
            </div>
          </label>

          <label className={labelClass}>
            API key
            <div className="relative">
              <input
                required
                disabled={Boolean(account)}
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your API key"
                autoComplete="off"
                className={`${inputClass} pr-11 disabled:text-muted`}
              />
              <button
                type="button"
                aria-label={showKey ? "Hide key" : "Show key"}
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-brand/10 hover:text-brand"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <span className="text-xs font-normal text-muted">
              In Freshdesk: your profile picture → Profile settings → View API
              key. It isn't saved, so paste it again next time.
            </span>
          </label>
        </div>

        {!account ? (
          <div className="grid gap-2 sm:flex sm:items-center">
            <button
              type="submit"
              disabled={busy}
              className={`${primaryButton} flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60`}
            >
              <Link2 className="h-4 w-4" />
              {busy ? "Connecting…" : "Connect"}
            </button>
            <span className="text-center text-xs text-muted sm:text-left">
              Your API key is only used for this import. It's never saved.
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-brand/10 px-3 py-2.5 text-sm">
              <CircleCheck className="h-4 w-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1 text-brand">
                Connected as <span className="font-medium">{account.name}</span>
                {account.email && ` (${account.email})`}
              </span>
              <button
                type="button"
                onClick={disconnect}
                disabled={Boolean(progress)}
                className="cursor-pointer text-sm text-muted underline-offset-2 hover:text-ink hover:underline disabled:cursor-default disabled:no-underline"
              >
                Disconnect
              </button>
            </div>

            {/* What to get */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                What to get
                <select
                  value={amount}
                  disabled={Boolean(progress)}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {AMOUNTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-start gap-3 self-end rounded-lg border border-line p-3">
                <input
                  type="checkbox"
                  checked={withConversations}
                  disabled={Boolean(progress)}
                  onChange={(e) => setWithConversations(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Include notes and replies
                  </span>
                  <span className="block text-xs text-muted">
                    One extra request per ticket, so it's slower
                  </span>
                </span>
              </label>
            </div>

            {amount === "all" && withConversations && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Freshdesk only allows a set number of requests a minute. With
                thousands of tickets this can take a long while, so keep this
                tab open. It waits and carries on by itself.
              </p>
            )}

            {progress ? (
              <div className="flex flex-col gap-2">
                <div className="h-2 overflow-hidden rounded-full bg-page">
                  <div
                    className={`h-full rounded-full bg-brand transition-all ${
                      progress.total ? "" : "w-1/3 animate-pulse"
                    }`}
                    style={
                      progress.total
                        ? {
                            width: `${Math.round((progress.done / progress.total) * 100)}%`,
                          }
                        : undefined
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">{progress.message}</p>
                  <button
                    type="button"
                    onClick={() => cancelRef.current?.abort()}
                    className={secondaryButton}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid sm:flex">
                <button
                  type="button"
                  onClick={fetchData}
                  className={`${primaryButton} flex items-center justify-center gap-2`}
                >
                  <CloudDownload className="h-4 w-4" />
                  Get data from Freshdesk
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="flex items-start gap-2 text-sm text-red-500">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}
