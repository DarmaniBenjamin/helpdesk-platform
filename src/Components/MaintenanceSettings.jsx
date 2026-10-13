import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronDown, ExternalLink, GitBranch, KeyRound, Plug, Sparkles } from "lucide-react";
import Droplets from "./Droplets";
import PasswordInput from "./PasswordInput";
import { inputClass, labelClass, primaryButton, secondaryButton } from "./formStyles";
import { Alert, CopyRow, OnOffPill, Part, ToggleRow } from "./integrationParts";
import { api } from "../api";

// Maintenance → AI & GitHub (Super Admin; server/src/maintenanceSettings.js).
// Everything the AI investigations need, set here: connecting GitHub (one
// click: GitHub makes an app for this helpdesk), choosing the AI, its key
// (kept on GitHub, encrypted) or "Continue with ChatGPT", and when to
// investigate.

const ABOUT = {
  github: "Free, nothing to set up. Rate-limited, and it reads less code at a time: good for small fixes.",
  anthropic: "Claude. Strong at finding causes and fixing code. Needs an API key (Claude Max and Team plans include monthly API credits).",
  openai: "ChatGPT. An API key, or Continue with ChatGPT to use a Plus or Pro plan (needs OpenAI's approval first).",
  gemini: "Gemini. An API key from Google AI Studio, which has a free tier.",
};

const MESSAGES = {
  github: "GitHub is connected. Press Test connection to check everything.",
  chatgpt: "Signed in with ChatGPT.",
};

// Sends the browser to GitHub with the app's manifest (GitHub's one-click
// "make an app" page)
function goToGitHub({ action, manifest }) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = manifest;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
}

function KeyBox({ info, provider, busy, onSave, onRemove }) {
  const [key, setKey] = useState("");
  const p = info.providers[provider];
  const state = info.keys[provider];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {state === "set" ? (
          <span className="text-brand">✓ {p.label} key saved on GitHub (encrypted).</span>
        ) : state === "unknown" ? (
          <span className="text-muted">Can't tell if a key is saved (the connection can't list secrets).</span>
        ) : (
          <span className="text-amber-700">No {p.label} key saved yet.</span>
        )}{" "}
        {p.keyUrl && (
          <a href={p.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
            Get a key <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <PasswordInput
            value={key}
            onChange={(e) => setKey(e.target.value.trim())}
            placeholder={state === "set" ? "Paste a new key to replace it" : `Paste your ${p.label} key`}
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          disabled={!key || busy === "key"}
          onClick={async () => (await onSave(provider, key)) && setKey("")}
          className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
        >
          {busy === "key" ? <Droplets className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          Save key
        </button>
      </div>
      {state === "set" && (
        <button type="button" onClick={() => onRemove(provider)} className="w-fit cursor-pointer text-sm text-muted hover:text-red-500">
          Remove the key from GitHub
        </button>
      )}
      <p className="text-xs text-muted">
        It goes straight to GitHub as an encrypted secret: the helpdesk doesn't keep it, and nobody can read it back.
      </p>
    </div>
  );
}

export default function MaintenanceSettings({ onChanged }) {
  const [params, setParams] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [tests, setTests] = useState(null);
  const [form, setForm] = useState(null);
  const [client, setClient] = useState({ clientId: "", clientSecret: "" });

  function show(data) {
    setInfo(data);
    setForm({
      provider: data.provider,
      model: data.model,
      openaiMode: data.openaiMode,
      auto: data.auto,
      maxPerDay: data.maxPerDay,
      maxPerMonth: data.maxPerMonth,
      allowPublic: data.allowPublic,
      approvers: data.approvers.join(", "),
    });
    setClient((c) => ({ ...c, clientId: data.openai.clientId }));
    if (!data.connected) setOpen(true);
  }

  useEffect(() => {
    api("/maintenance/settings")
      .then(show)
      .catch((err) => setLoadError(err.message));
  }, []);

  // Coming back from GitHub or OpenAI: ?connected=github or ?error=...
  const returned = params.get("connected");
  const returnedError = params.get("error");
  const clearReturn = () => {
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("error");
    setParams(next, { replace: true });
  };

  async function run(what, request, message = "") {
    setBusy(what);
    setError("");
    setNotice("");
    try {
      const data = await request();
      if (data?.provider !== undefined) show(data);
      if (message) setNotice(message);
      onChanged?.();
      return data ?? true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!info || !form)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Droplets className="h-4 w-4" /> Loading…
      </p>
    );

  const p = info.providers;
  const needsKey = form.provider !== "github" && !(form.provider === "openai" && form.openaiMode === "signin");
  const changed =
    form.provider !== info.provider ||
    form.model !== info.model ||
    form.openaiMode !== info.openaiMode ||
    form.auto !== info.auto ||
    Number(form.maxPerDay) !== info.maxPerDay ||
    Number(form.maxPerMonth) !== info.maxPerMonth ||
    form.allowPublic !== info.allowPublic ||
    form.approvers !== info.approvers.join(", ");

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-6">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex cursor-pointer items-start justify-between gap-3 text-left">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">AI &amp; GitHub</h2>
            <p className="text-sm text-muted">
              {info.connected
                ? `Connected to ${info.repo}. AI: ${p[info.provider].label}.`
                : "Connect GitHub and choose an AI, so incidents can be investigated and fixes proposed."}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <OnOffPill on={info.connected} />
          <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {returned && (
        <Alert tone="ok">
          {MESSAGES[returned] ?? "Done."}{" "}
          <button type="button" onClick={clearReturn} className="cursor-pointer underline">OK</button>
        </Alert>
      )}
      {returnedError && (
        <Alert>
          {returnedError}{" "}
          <button type="button" onClick={clearReturn} className="cursor-pointer underline">OK</button>
        </Alert>
      )}

      {open && (
        <>
          {info.source === "env" && info.connected && (
            <Alert tone="warn">
              This is still using the older settings in server/.env. Connect GitHub here and they're no longer needed.
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="ok">{notice}</Alert>}

          {/* ---------- 1. GitHub ---------- */}
          <Part title="1. GitHub" hint="Where the AI investigates and proposes fixes, as pull requests for a person to approve.">
            {info.connected && info.source === "settings" ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  Connected to <strong>{info.repo}</strong>
                  {info.auth === "app" && info.app ? (
                    <>
                      {" "}through its own GitHub App ({info.app.slug}).{" "}
                      <a href={info.app.htmlUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        The app on GitHub
                      </a>
                    </>
                  ) : (
                    " with a token."
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === "test"}
                    onClick={() => run("test", async () => {
                      const r = await api("/maintenance/settings/github/test", { method: "POST" });
                      setTests(r.checks);
                    })}
                    className={`${secondaryButton} flex items-center justify-center gap-2`}
                  >
                    {busy === "test" ? <Droplets className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                    Test connection
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Disconnect GitHub? Investigations stop until it's connected again. (The app stays on GitHub: delete it there too if you're done with it.)"))
                        run("disconnect", () => api("/maintenance/settings/github", { method: "DELETE" }));
                    }}
                    className="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-sm text-muted hover:text-red-500"
                  >
                    Disconnect
                  </button>
                </div>
                {tests && (
                  <ul className="flex flex-col gap-1.5 rounded-lg bg-page p-3 text-sm">
                    {tests.map((t) => (
                      <li key={t.label}>
                        <span className={t.ok ? "text-brand" : "text-red-600"}>{t.ok ? "✓" : "✗"}</span> {t.label}
                        {t.fix && <span className="block pl-5 text-muted">{t.fix}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className={labelClass}>
                  <span>The repository</span>
                  <input
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="DarmaniBenjamin/helpdesk-platform"
                    className={inputClass}
                  />
                </label>
                <ol className="list-decimal pl-5 text-sm text-muted">
                  <li>Press Connect GitHub. GitHub opens and asks to create an app for this helpdesk: press <strong>Create GitHub App</strong>.</li>
                  <li>It then asks where to install it: choose <strong>Only select repositories</strong>, pick the repository, and press <strong>Install</strong>.</li>
                  <li>You come back here, connected. Nothing to copy.</li>
                </ol>
                <div className="flex">
                  <button
                    type="button"
                    disabled={!repo || busy === "connect"}
                    onClick={() => run("connect", async () => {
                      goToGitHub(await api("/maintenance/settings/github/start", { method: "POST", body: { repo } }));
                    })}
                    className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
                  >
                    {busy === "connect" ? <Droplets className="h-4 w-4" /> : <GitBranch className="h-4 w-4" />}
                    Connect GitHub
                  </button>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Advanced: use a token instead</summary>
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-muted">
                      A fine-grained token for that one repository, with Issues: Read and write, Pull requests: Read, Checks: Read and Secrets: Read and write.
                    </p>
                    <PasswordInput value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="github_pat_…" autoComplete="off" />
                    <div className="flex">
                      <button
                        type="button"
                        disabled={!repo || !token || busy === "token"}
                        onClick={async () => (await run("token", () => api("/maintenance/settings/github/token", { method: "POST", body: { repo, token } }), "Connected with the token.")) && setToken("")}
                        className={`${secondaryButton} disabled:opacity-60`}
                      >
                        Connect with the token
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            )}
          </Part>

          {/* ---------- 2. The AI ---------- */}
          <Part title="2. The AI" hint="Which AI investigates. You can change it any time.">
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(p).map(([id, provider]) => (
                <label
                  key={id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition ${
                    form.provider === id ? "border-brand bg-brand/5" : "border-line hover:border-brand/40"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="ai-provider"
                      checked={form.provider === id}
                      onChange={() => setForm({ ...form, provider: id, model: id === info.provider ? info.model : "" })}
                    />
                    {provider.label}
                  </span>
                  <span className="text-muted">{ABOUT[id]}</span>
                </label>
              ))}
            </div>

            <label className={labelClass}>
              <span>
                Model <span className="font-normal text-muted">(leave empty for {p[form.provider].model})</span>
              </span>
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value.trim() })}
                placeholder={p[form.provider].model}
                className={inputClass}
              />
            </label>

            {form.provider === "openai" && (
              <div className="flex flex-col rounded-lg border border-line p-0.5 text-sm sm:flex-row">
                {[
                  ["key", "API key"],
                  ["signin", "Continue with ChatGPT"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm({ ...form, openaiMode: mode })}
                    className={`min-h-9 flex-1 cursor-pointer rounded-md px-3 py-1.5 leading-tight ${form.openaiMode === mode ? "bg-brand/10 font-medium text-brand" : "text-muted"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {needsKey && info.connected && (
              <KeyBox
                info={info}
                provider={form.provider}
                busy={busy}
                onSave={(provider, key) =>
                  run("key", () => api("/maintenance/settings/key", { method: "PUT", body: { provider, key } }), "Key saved on GitHub.")
                }
                onRemove={(provider) =>
                  run("key", () => api(`/maintenance/settings/key/${provider}`, { method: "DELETE" }), "Key removed from GitHub.")
                }
              />
            )}
            {needsKey && !info.connected && (
              <p className="text-sm text-muted">Connect GitHub first: the key is kept there.</p>
            )}

            {form.provider === "openai" && form.openaiMode === "signin" && (
              <div className="flex flex-col gap-3 rounded-lg bg-page p-3 text-sm">
                {info.openai.signedIn ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-brand">✓ Signed in with ChatGPT{info.openai.email ? ` as ${info.openai.email}` : ""}.</span>
                    <button
                      type="button"
                      onClick={() => run("signout", () => api("/maintenance/settings/openai", { method: "DELETE" }), "Signed out of ChatGPT.")}
                      className="cursor-pointer text-muted hover:text-red-500"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <>
                    <p>
                      Uses your ChatGPT Plus or Pro plan, no API key. OpenAI has to approve this helpdesk first:
                      ask OpenAI for a <strong>Sign in with ChatGPT</strong> client with plan usage, and give them this callback address:
                    </p>
                    <CopyRow value={info.openai.callbackUrl} label="address" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className={labelClass}>
                        <span>Client ID (from OpenAI)</span>
                        <input value={client.clientId} onChange={(e) => setClient({ ...client, clientId: e.target.value.trim() })} placeholder="oaiapp_…" className={inputClass} />
                      </label>
                      <label className={labelClass}>
                        <span>
                          Client secret{" "}
                          <span className="font-normal text-muted">{info.openai.hasClientSecret ? "(saved; leave empty to keep it)" : "(if OpenAI gave you one)"}</span>
                        </span>
                        <PasswordInput value={client.clientSecret} onChange={(e) => setClient({ ...client, clientSecret: e.target.value.trim() })} autoComplete="off" />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!client.clientId || busy === "client"}
                        onClick={() => run("client", () => api("/maintenance/settings/openai-client", { method: "PUT", body: client }), "Saved. Now press Continue with ChatGPT.")}
                        className={`${secondaryButton} disabled:opacity-60`}
                      >
                        Save
                      </button>
                      {info.openai.clientId ? (
                        <a href="/api/maintenance/openai/signin" className={`${primaryButton} flex h-auto! min-h-11 items-center justify-center py-2 text-center`}>
                          Continue with ChatGPT
                        </a>
                      ) : (
                        <span className={`${primaryButton} flex h-auto! min-h-11 cursor-not-allowed items-center justify-center py-2 text-center opacity-50`}>Continue with ChatGPT</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Part>

          {/* ---------- 3. When ---------- */}
          <Part title="3. When to investigate">
            <ToggleRow
              title="Investigate serious errors by themselves"
              hint="Off: only when someone presses Investigate with AI on an incident."
              on={form.auto}
              onChange={(on) => setForm({ ...form, auto: on })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                <span>At most, by themselves, per day</span>
                <input type="number" min={0} max={50} value={form.maxPerDay} onChange={(e) => setForm({ ...form, maxPerDay: e.target.value })} className={inputClass} />
              </label>
              <label className={labelClass}>
                <span>At most per month (the button too)</span>
                <input type="number" min={0} max={500} value={form.maxPerMonth} onChange={(e) => setForm({ ...form, maxPerMonth: e.target.value })} className={inputClass} />
              </label>
            </div>
            <ToggleRow
              title="Allow a public repository (testing only)"
              hint="Issues on a public repository can be read by anyone. Secrets and personal details are removed first, but only use this for test bugs, and turn it off when the repository is private."
              on={form.allowPublic}
              onChange={(on) => setForm({ ...form, allowPublic: on })}
            />
            <label className={labelClass}>
              <span>
                Approvers <span className="font-normal text-muted">(GitHub usernames, optional: a merge by anyone else is flagged)</span>
              </span>
              <input value={form.approvers} onChange={(e) => setForm({ ...form, approvers: e.target.value })} placeholder="DarmaniBenjamin" className={inputClass} />
            </label>
          </Part>

          {changed && (
            <div className="flex border-t border-line pt-4">
              <button
                type="button"
                disabled={busy === "save"}
                onClick={() => run("save", () => api("/maintenance/settings", { method: "PUT", body: { ...form, maxPerDay: Number(form.maxPerDay), maxPerMonth: Number(form.maxPerMonth) } }), "Saved.")}
                className={`${primaryButton} flex items-center justify-center gap-2 disabled:opacity-60`}
              >
                {busy === "save" && <Droplets className="h-4 w-4" />}
                Save
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
