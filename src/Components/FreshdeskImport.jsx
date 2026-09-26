import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  KeyRound,
  Upload,
  FileJson,
  Download,
  Lock,
  CircleCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import Card from "./Card";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./formStyles";
import {
  CONTACT_FIELDS,
  TICKET_FIELDS,
  EXAMPLE_EXPORT,
  readExport,
  sourceKeys,
  guessMapping,
  sampleText,
  convertContacts,
  convertTickets,
  mergeCustomers,
  mergeTickets,
} from "./freshdeskMapping";
import { downloadJson, readJsonFile } from "./backupUtils";
import { DEPARTMENTS, STATUSES, PRIORITIES, findDepartment } from "../data";
import useData from "../useData";

// ---------- Small pieces ----------

// "Bring over contacts" with a switch on the right
function SectionToggle({ on, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 cursor-pointer accent-brand"
      />
      <span className="text-sm font-medium">{children}</span>
    </label>
  );
}

// One table of "this app's field <- Freshdesk field", with a tick box
// to leave a field out, and an example value from the file
function MappingTable({
  fields,
  mapping,
  onChange,
  keys,
  firstRecord,
  disabled,
}) {
  return (
    <ul
      className={`-mx-5 divide-y divide-line border-t border-line ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      {fields.map((field) => {
        const m = mapping[field.key];
        return (
          <li
            key={field.key}
            className="grid gap-2 px-5 py-3 transition hover:bg-brand/5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={m.on}
                disabled={field.required}
                onChange={(e) =>
                  onChange(field.key, { ...m, on: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand disabled:cursor-default"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {field.label}
                  {field.required && (
                    <span className="ml-1.5 text-xs font-normal text-muted">
                      required
                    </span>
                  )}
                </span>
                {field.hint && (
                  <span className="block text-xs text-muted">{field.hint}</span>
                )}
              </span>
            </label>

            <select
              aria-label={`Freshdesk field for ${field.label}`}
              value={m.source}
              disabled={!m.on}
              onChange={(e) =>
                onChange(field.key, { ...m, source: e.target.value })
              }
              className={`${inputClass} cursor-pointer disabled:cursor-default disabled:opacity-50`}
            >
              <option value="">Not in the file</option>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>

            <p className="truncate text-xs text-muted sm:col-span-2 lg:col-span-1">
              <span className="lg:hidden">Example: </span>
              {m.on && m.source && firstRecord
                ? sampleText(firstRecord[m.source])
                : "—"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// A few lines showing what one record will look like after the import
function PreviewList({ rows }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="mb-1 truncate font-medium sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function countLine(label, r) {
  return `${label}: ${r.added} added, ${r.updated} updated, ${r.skipped} left as they were`;
}

// ---------- The page section ----------

export default function FreshdeskImport() {
  const { customers, tickets, settings, updateSettings, saveImport } =
    useData();
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [source, setSource] = useState(null); // what's in the uploaded file(s)
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);

  const [contactMapping, setContactMapping] = useState({});
  const [ticketMapping, setTicketMapping] = useState({});
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includeTickets, setIncludeTickets] = useState(true);
  const [department, setDepartment] = useState(DEPARTMENTS[0].id);
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState(null);

  // ----- Loading files -----

  async function loadFiles(fileList) {
    const files = [...fileList];
    if (files.length === 0) return;
    setFileError("");
    setResult(null);

    const found = { tickets: [], contacts: [], companies: [] };
    try {
      for (const file of files) {
        const part = readExport(await readJsonFile(file));
        found.tickets.push(...part.tickets);
        found.contacts.push(...part.contacts);
        found.companies.push(...part.companies);
      }
    } catch (err) {
      setFileError(err.message);
      return;
    }

    if (found.tickets.length === 0 && found.contacts.length === 0) {
      setFileError("No tickets or contacts were found in that file.");
      return;
    }

    const contactKeys = sourceKeys(found.contacts);
    const ticketKeys = sourceKeys(found.tickets);
    setSource({
      ...found,
      contactKeys,
      ticketKeys,
      fileNames: files.map((f) => f.name),
    });
    setContactMapping(guessMapping(CONTACT_FIELDS, contactKeys));
    setTicketMapping(guessMapping(TICKET_FIELDS, ticketKeys));
    setIncludeContacts(found.contacts.length > 0);
    setIncludeTickets(found.tickets.length > 0);
  }

  function clearFiles() {
    setSource(null);
    setResult(null);
    setFileError("");
  }

  // ----- Working out what the import will do -----
  // Recalculated only when something it depends on changes, because
  // thousands of tickets take a moment to convert.
  const plan = useMemo(() => {
    if (!source) return null;

    const contacts = includeContacts
      ? convertContacts(source.contacts, contactMapping, source.companies)
      : { contacts: [], skipped: [] };
    const customerMerge = mergeCustomers(customers, contacts.contacts, replace);

    const converted = includeTickets
      ? convertTickets(
          source.tickets,
          ticketMapping,
          customerMerge.list,
          department,
          customerMerge.aliases,
        )
      : { tickets: [], skipped: [] };
    const ticketMerge = mergeTickets(tickets, converted.tickets, replace);

    return {
      contacts,
      converted,
      customerMerge,
      ticketMerge,
      problems: [...contacts.skipped, ...converted.skipped],
    };
  }, [
    source,
    includeContacts,
    includeTickets,
    contactMapping,
    ticketMapping,
    customers,
    tickets,
    department,
    replace,
  ]);

  function runImport() {
    saveImport(plan.customerMerge.list, plan.ticketMerge.list);
    setResult({
      customers: plan.customerMerge,
      tickets: plan.ticketMerge,
      problems: plan.problems,
    });
    setSource(null);
  }

  const nothingToImport =
    !plan ||
    (plan.contacts.contacts.length === 0 &&
      plan.converted.tickets.length === 0);

  const firstContact = plan?.contacts.contacts[0];
  const firstTicket = plan?.converted.tickets[0];

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Connect with the API (needs the backend) */}
      <Card title="Connect to Freshdesk">
        <div className="-mt-2 flex flex-col gap-4">
          <p className="text-sm text-muted">
            Pull tickets and contacts straight from your Freshdesk account.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Freshdesk address
              <div className="flex items-center rounded-lg border border-line bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                <input
                  value={settings.freshdesk.domain}
                  onChange={(e) =>
                    updateSettings("freshdesk", {
                      domain: e.target.value.trim().toLowerCase(),
                    })
                  }
                  placeholder="yourcompany"
                  autoComplete="off"
                  className="h-11 w-full min-w-0 rounded-l-lg bg-transparent px-3 text-base placeholder:text-muted focus:outline-none sm:text-sm"
                />
                <span className="shrink-0 pr-3 text-sm font-normal text-muted">
                  .freshdesk.com
                </span>
              </div>
            </label>
            <label className={labelClass}>
              API key
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  disabled
                  placeholder="Added on the server"
                  className={`${inputClass} pl-9 disabled:cursor-not-allowed disabled:bg-page`}
                />
              </div>
            </label>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-page p-3 text-sm">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <p className="text-muted">
              This switches on once the backend is built. Your API key has to
              stay secret on the server, and Freshdesk blocks requests made
              straight from a browser. For now, upload a JSON export below, like
              the one your{" "}
              <code className="rounded bg-white px-1 text-ink">
                freshdesk_export.py
              </code>{" "}
              script makes.
            </p>
          </div>
        </div>
      </Card>

      {/* Upload */}
      {!source && (
        <Card
          title="Import a JSON export"
          action={
            <button
              type="button"
              onClick={() =>
                downloadJson(EXAMPLE_EXPORT, "freshdesk-example.json")
              }
              className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:border-brand/40 hover:text-brand active:scale-[0.97]"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Example file</span>
            </button>
          }
        >
          <button
            type="button"
            onClick={() => fileInput.current.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              loadFiles(e.dataTransfer.files);
            }}
            className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition active:scale-[0.99] ${
              dragging
                ? "border-brand bg-brand/5"
                : "border-line hover:border-brand/40 hover:bg-brand/5"
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Upload className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium">
              Choose JSON files, or drop them here
            </span>
            <span className="max-w-md text-xs text-muted">
              One file with tickets, contacts and companies, or separate files
              for each. Pick several at once.
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            multiple
            onChange={(e) => {
              loadFiles(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
          {fileError && (
            <p className="mt-3 flex items-center gap-2 text-sm text-red-500">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              {fileError}
            </p>
          )}
        </Card>
      )}

      {/* Result of the last import */}
      {result && (
        <Card title="Import finished">
          <div className="-mt-2 flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-medium text-brand">
              <CircleCheck className="h-5 w-5" />
              Your Freshdesk data is in.
            </p>
            <ul className="flex flex-col gap-1 text-sm text-muted">
              <li>{countLine("Customers", result.customers)}</li>
              <li>{countLine("Tickets", result.tickets)}</li>
            </ul>
            {result.problems.length > 0 && (
              <details className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <summary className="cursor-pointer font-medium">
                  {result.problems.length} couldn't be imported
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                  {result.problems.slice(0, 20).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="grid gap-2 sm:flex">
              <button
                type="button"
                onClick={() => navigate("/inbox")}
                className={primaryButton}
              >
                View in Inbox
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className={secondaryButton}
              >
                Done
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Choose what comes over */}
      {source && plan && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
            <FileJson className="h-5 w-5 shrink-0 text-brand" />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{source.fileNames.join(", ")}</span>
              <span className="block text-muted sm:inline">
                {" "}
                · {source.tickets.length} tickets, {source.contacts.length}{" "}
                contacts, {source.companies.length} companies
              </span>
            </p>
            <button
              type="button"
              onClick={clearFiles}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm text-muted transition hover:bg-white hover:text-ink active:scale-[0.97]"
            >
              <X className="h-4 w-4" />
              Start over
            </button>
          </div>

          <Card
            title="Contacts"
            action={
              <SectionToggle on={includeContacts} onChange={setIncludeContacts}>
                Bring over
              </SectionToggle>
            }
          >
            {source.contacts.length === 0 ? (
              <p className="text-sm text-muted">
                No contacts in this file. Tickets will be matched to customers
                you already have.
              </p>
            ) : (
              <MappingTable
                fields={CONTACT_FIELDS}
                mapping={contactMapping}
                onChange={(key, value) =>
                  setContactMapping((m) => ({ ...m, [key]: value }))
                }
                keys={source.contactKeys}
                firstRecord={source.contacts[0]}
                disabled={!includeContacts}
              />
            )}
          </Card>

          <Card
            title="Tickets"
            action={
              <SectionToggle on={includeTickets} onChange={setIncludeTickets}>
                Bring over
              </SectionToggle>
            }
          >
            {source.tickets.length === 0 ? (
              <p className="text-sm text-muted">No tickets in this file.</p>
            ) : (
              <MappingTable
                fields={TICKET_FIELDS}
                mapping={ticketMapping}
                onChange={(key, value) =>
                  setTicketMapping((m) => ({ ...m, [key]: value }))
                }
                keys={source.ticketKeys}
                firstRecord={source.tickets[0]}
                disabled={!includeTickets}
              />
            )}
          </Card>

          <Card title="Options">
            <div className="-mt-2 grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Put imported tickets in team
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-muted">
                  You can move them afterwards. Tickets come in unassigned.
                </span>
              </label>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">
                  If a ticket or customer already exists
                </legend>
                {[
                  [false, "Keep what's here", "Skip it and leave it as it is"],
                  [
                    true,
                    "Replace it",
                    "Overwrite it with the Freshdesk version",
                  ],
                ].map(([value, label, hint]) => (
                  <label
                    key={label}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                      replace === value
                        ? "border-brand bg-brand/5"
                        : "border-line hover:border-brand/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="existing"
                      checked={replace === value}
                      onChange={() => setReplace(value)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
                    />
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          </Card>

          {/* What it'll look like */}
          {(firstContact || firstTicket) && (
            <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
              {firstContact && (
                <Card title="Preview: first customer">
                  <PreviewList
                    rows={[
                      ["Name", firstContact.name],
                      ["Email", firstContact.email],
                      ["Phone", firstContact.phone || "None"],
                      ["Business", firstContact.company ?? "Individual"],
                      [
                        "Extra emails",
                        firstContact.extraEmails.join(", ") || "None",
                      ],
                    ]}
                  />
                </Card>
              )}
              {firstTicket && (
                <Card title="Preview: first ticket">
                  <PreviewList
                    rows={[
                      ["Ticket", `#${firstTicket.id}`],
                      ["Subject", firstTicket.subject],
                      ["Customer", firstTicket.requester.name],
                      ["Status", STATUSES[firstTicket.status].label],
                      ["Priority", PRIORITIES[firstTicket.priority].label],
                      ["Team", findDepartment(firstTicket.department).name],
                      [
                        "Created",
                        new Date(firstTicket.createdAt).toLocaleString(
                          "en-US",
                          { dateStyle: "medium", timeStyle: "short" },
                        ),
                      ],
                      [
                        "Messages",
                        `${firstTicket.messages.length} (${
                          firstTicket.messages.filter((m) => m.kind === "note")
                            .length
                        } notes)`,
                      ],
                    ]}
                  />
                </Card>
              )}
            </div>
          )}

          {/* Summary and the big button */}
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
            <p className="text-sm font-semibold">Ready to import</p>
            <ul className="flex flex-col gap-1 text-sm text-muted">
              <li>{countLine("Customers", plan.customerMerge)}</li>
              <li>{countLine("Tickets", plan.ticketMerge)}</li>
            </ul>
            {plan.problems.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {plan.problems.length} can't be imported, e.g.{" "}
                {plan.problems[0]}
              </p>
            )}
            <div className="grid gap-2 sm:flex sm:justify-end">
              <button
                type="button"
                onClick={runImport}
                disabled={nothingToImport}
                className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand`}
              >
                Import
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
