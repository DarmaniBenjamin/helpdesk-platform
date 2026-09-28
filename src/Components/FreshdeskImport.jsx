import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Upload,
  FileJson,
  Download,
  CircleCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import Card from "./Card";
import FreshdeskConnect from "./FreshdeskConnect";
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
import { STATUSES, PRIORITIES, findDepartment } from "../data";
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
// to leave a field out, and an example value from the file.
// Underneath: the Freshdesk fields that are left behind, and everything
// Freshdesk sent for the first record.
function MappingTable({
  fields,
  mapping,
  onChange,
  keys,
  firstRecord,
  disabled,
  what,
}) {
  const used = new Set(
    Object.values(mapping)
      .filter((m) => m.on && m.source)
      .map((m) => m.source),
  );
  const leftBehind = keys.filter((k) => !used.has(k));

  return (
    <>
      <p className="-mt-2 mb-3 text-sm text-muted">
        Pick which Freshdesk field fills each of your fields. Untick anything
        you don't want. Fields you don't use are left behind in Freshdesk.
      </p>
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
                    <span className="block text-xs text-muted">
                      {field.hint}
                    </span>
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
                <option value="">Leave empty</option>
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

      {leftBehind.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">
            Not brought over ({leftBehind.length})
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {leftBehind.map((k) => (
              <span
                key={k}
                className="rounded-md bg-page px-2 py-0.5 text-xs text-muted line-through decoration-muted/50"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {firstRecord && (
        <details className="group mt-4 rounded-lg border border-line">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium transition hover:bg-brand/5">
            <span className="text-brand group-open:hidden">Show</span>
            <span className="hidden text-brand group-open:inline">
              Hide
            </span>{" "}
            everything Freshdesk sent for the first {what}
          </summary>
          <pre className="max-h-80 overflow-auto border-t border-line bg-page p-3 text-xs leading-relaxed">
            {JSON.stringify(firstRecord, null, 2)}
          </pre>
        </details>
      )}
    </>
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

// How a ticket came in, in words
const SOURCE_NAMES = {
  email: "Email",
  portal: "Customer portal",
  phone: "Phone",
  agent: "Created by the team",
};

// ---------- The page section ----------

export default function FreshdeskImport() {
  const { customers, tickets, team, departments, saveImport } = useData();
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [source, setSource] = useState(null); // what's in the uploaded file(s)
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);

  const [contactMapping, setContactMapping] = useState({});
  const [ticketMapping, setTicketMapping] = useState({});
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includeTickets, setIncludeTickets] = useState(true);
  // "" = No team yet
  const [department, setDepartment] = useState(() => departments[0]?.id ?? "");
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(null); // progress message
  const [importError, setImportError] = useState("");

  // ----- Loading data (from Freshdesk or from files) -----

  // Shows the matching screen for what was found
  function showFound(found, names) {
    if (found.tickets.length === 0 && found.contacts.length === 0) {
      setFileError("No tickets or contacts were found.");
      return;
    }
    const contactKeys = sourceKeys(found.contacts);
    const ticketKeys = sourceKeys(found.tickets);
    setSource({ ...found, contactKeys, ticketKeys, fileNames: names });
    setContactMapping(guessMapping(CONTACT_FIELDS, contactKeys));
    setTicketMapping(guessMapping(TICKET_FIELDS, ticketKeys));
    setIncludeContacts(found.contacts.length > 0);
    setIncludeTickets(found.tickets.length > 0);
    setResult(null);
    setFileError("");
    setImportError("");
  }

  // Saves exactly what Freshdesk sent as a JSON file, to keep or import later
  function saveAsFile() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(
      {
        companies: source.companies,
        contacts: source.contacts,
        tickets: source.tickets,
        agents: source.agents,
      },
      `freshdesk-export-${stamp}.json`,
    );
  }

  async function loadFiles(fileList) {
    const files = [...fileList];
    if (files.length === 0) return;
    setFileError("");
    setResult(null);

    const found = { tickets: [], contacts: [], companies: [], agents: [] };
    try {
      for (const file of files) {
        const part = readExport(await readJsonFile(file));
        found.tickets.push(...part.tickets);
        found.contacts.push(...part.contacts);
        found.companies.push(...part.companies);
        found.agents.push(...part.agents);
      }
    } catch (err) {
      setFileError(err.message);
      return;
    }

    showFound(
      found,
      files.map((f) => f.name),
    );
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
          source.agents ?? [],
          team,
        )
      : { tickets: [], skipped: [], unmatched: new Map() };
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
    team,
    department,
    replace,
  ]);

  // Saves everything to the database, in batches, showing how far it got
  async function runImport() {
    setImportError("");
    setImporting("Starting…");
    try {
      const saved = await saveImport(
        plan.contacts.contacts,
        plan.converted.tickets,
        replace,
        setImporting,
      );
      setResult({
        customers: saved.customers,
        tickets: saved.tickets,
        problems: [...plan.problems, ...saved.problems],
      });
      setSource(null);
    } catch (err) {
      setImportError(
        `The import stopped: ${err.message} Anything saved before this is kept, so you can run it again with "Keep what's here".`,
      );
    } finally {
      setImporting(null);
    }
  }

  const nothingToImport =
    !plan ||
    (plan.contacts.contacts.length === 0 &&
      plan.converted.tickets.length === 0);

  const firstContact = plan?.contacts.contacts[0];
  const firstTicket = plan?.converted.tickets[0];
  const unmatched = plan ? [...plan.converted.unmatched] : [];
  const assigneeName = (id) =>
    id ? (team.find((m) => m.id === id)?.name ?? "Someone") : "Nobody";

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Step 1a: get the data straight from Freshdesk */}
      {!source && (
        <FreshdeskConnect
          onFetched={(data, label) => showFound(data, [label])}
        />
      )}

      {/* Upload */}
      {!source && (
        <Card
          title="Or upload a JSON file"
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
              A file you saved from here earlier, or from your
              freshdesk_export.py script. One file with everything, or separate
              files for tickets, contacts and companies.
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
              onClick={saveAsFile}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm text-brand transition hover:bg-white active:scale-[0.97]"
            >
              <Download className="h-4 w-4" />
              Save as JSON
            </button>
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
                what="contact"
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
                what="ticket"
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
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                  <option value="">No team yet</option>
                </select>
                <span className="text-xs font-normal text-muted">
                  You can move them afterwards. Each ticket goes to the same
                  person as in Freshdesk, if they're on your team.
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
                      ["Email", firstContact.email ?? "None"],
                      ["Phone", firstContact.phone || "None"],
                      [
                        "Extra phones",
                        firstContact.extraPhones.join(", ") || "None",
                      ],
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
                      ["Assigned to", assigneeName(firstTicket.assignee)],
                      [
                        "Source",
                        SOURCE_NAMES[firstTicket.source] ?? firstTicket.source,
                      ],
                      ["Tags", firstTicket.tags.join(", ") || "None"],
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
              <details className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <summary className="flex cursor-pointer items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {plan.problems.length} can't be imported, e.g.{" "}
                    {plan.problems[0]}
                  </span>
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                  {plan.problems.slice(0, 50).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
            {unmatched.length > 0 && (
              <details className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <summary className="flex cursor-pointer items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {unmatched.reduce((n, [, count]) => n + count, 0)} tickets
                    were assigned in Freshdesk to people who aren't on your team
                    yet. They'll come in unassigned.
                  </span>
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                  {unmatched.map(([name, count]) => (
                    <li key={name}>
                      {name}: {count} ticket{count === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  Best fix: invite them on the Team page with the same email
                  they use in Freshdesk, and import once they've joined. You can
                  also assign these tickets by hand afterwards.
                </p>
              </details>
            )}
            {importError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {importError}
              </p>
            )}
            <div className="grid gap-2 sm:flex sm:items-center sm:justify-end">
              {importing && (
                <p className="text-center text-sm text-muted sm:mr-auto sm:text-left">
                  {importing}
                </p>
              )}
              <button
                type="button"
                onClick={runImport}
                disabled={nothingToImport || Boolean(importing)}
                className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand`}
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
