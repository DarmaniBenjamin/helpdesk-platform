import { useState } from "react";
import {
  Search,
  UserPlus,
  Pencil,
  Trash2,
  X,
  Check,
  Minus,
  Users,
  ShieldCheck,
  Headset,
  MailQuestion,
  Building2,
  Eye,
  Link2,
} from "lucide-react";
import Avatar from "../Avatar";
import Card from "../Card";
import Modal from "../Modal";
import RoleBadge from "../RoleBadge";
import MemberModal from "../MemberModal";
import DepartmentsCard from "../DepartmentsCard";
import { inputClass, secondaryButton } from "../formStyles";
import { ROLES, PERMISSIONS, canManage, displayName } from "../teamRoles";
import { findDepartment, isDone, timeAgo } from "../../data";
import { copyText, inviteLinkFor } from "../copyText";
import useData from "../../useData";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "invited", label: "Invited" },
];

// The Super Admin comes first, then admins, agents, customers
const ROLE_ORDER = Object.keys(ROLES);

// A small square button with just an icon, e.g. the pencil or the trash can
function IconAction({ label, onClick, danger, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition active:scale-[0.92] ${
        danger
          ? "hover:bg-red-50 hover:text-red-500"
          : "hover:bg-brand/10 hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, icon }) {
  const Icon = icon;
  return (
    <div className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

// The member's departments as small grey pills
function TeamList({ departments }) {
  if (departments.length === 0)
    return <span className="text-sm text-muted">No department</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {departments.map((id) => (
        <span
          key={id}
          className="whitespace-nowrap rounded-md bg-page px-2 py-0.5 text-xs"
        >
          {findDepartment(id).name}
        </span>
      ))}
    </div>
  );
}

// "Active 2 hours ago" or "Invited 3 days ago"
function StatusText({ member }) {
  if (member.status === "invited") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-amber-600">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Invited {timeAgo(member.invitedAt)}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap text-sm text-muted">
      Active {timeAgo(member.lastActiveAt)}
    </span>
  );
}

// The buttons at the end of each row. What shows depends on the member,
// and on what you're allowed to do (Admins can't change other Admins).
function MemberActions({
  member,
  allowed,
  justCopied,
  onEdit,
  onCopyLink,
  onRemove,
}) {
  if (!allowed) return null;
  // A customer's name and email come from their customer record,
  // so there's nothing to edit here
  const canEdit = member.role !== "customer";

  if (member.status === "invited") {
    return (
      <div className="flex items-center justify-end gap-1">
        {/* Makes a fresh invite link and copies it, to send them yourself
            (the old link stops working). Replaces "Resend" until invite
            emails are set up. */}
        {justCopied ? (
          <span className="flex h-9 items-center gap-1 px-2 text-xs font-medium text-brand">
            <Check className="h-3.5 w-3.5" />
            Copied
          </span>
        ) : (
          <IconAction
            label="Copy a new invite link (the old one stops working)"
            onClick={onCopyLink}
          >
            <Link2 className="h-4 w-4" />
          </IconAction>
        )}
        {canEdit && (
          <IconAction label="Edit invite" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconAction>
        )}
        <IconAction label="Cancel invite" onClick={onRemove} danger>
          <X className="h-4 w-4" />
        </IconAction>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <IconAction label="Edit member" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </IconAction>
      )}
      <IconAction
        label={canEdit ? "Remove from team" : "Remove portal access"}
        onClick={onRemove}
        danger
      >
        <Trash2 className="h-4 w-4" />
      </IconAction>
    </div>
  );
}

// "Are you sure?" before removing someone or cancelling their invite
function RemoveModal({ member, openTickets, onConfirm, onClose }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isInvite = member.status === "invited";
  const isCustomer = member.role === "customer";
  const name = displayName(member);

  let title = "Remove team member?";
  if (isInvite) title = "Cancel invite?";
  else if (isCustomer) title = "Remove portal access?";

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Keep
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(); // saves to the database
                onClose();
              } catch (err) {
                setError(err.message);
                setBusy(false);
              }
            }}
            className="h-11 flex-1 cursor-pointer rounded-lg bg-red-500 px-5 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:flex-none"
          >
            {busy ? "Saving…" : isInvite ? "Cancel invite" : "Remove"}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} photo={member.photo} />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-sm text-muted">{member.email}</p>
        </div>
      </div>
      {isInvite ? (
        <p className="text-sm text-muted">
          Their invite link will stop working. You can invite them again later.
        </p>
      ) : isCustomer ? (
        <p className="text-sm text-muted">
          They won't be able to sign in to the customer portal anymore. They
          stay in your customers, and their tickets aren't touched.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            They won't be able to sign in anymore. Their replies and notes stay
            on the tickets.
          </p>
          {openTickets > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
              {openTickets} unfinished ticket
              {openTickets === 1 ? " is" : "s are"} assigned to them.{" "}
              {openTickets === 1 ? "It" : "They"} will become unassigned.
            </p>
          )}
        </>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Modal>
  );
}

// Table showing which access level can do what
function PermissionsTable() {
  return (
    <Card title="What each access level can do">
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-160 text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-5 py-3 font-medium">Permission</th>
              {ROLE_ORDER.map((id) => (
                <th
                  key={id}
                  className="whitespace-nowrap px-3 py-3 text-center font-medium"
                >
                  {ROLES[id].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr
                key={p.label}
                className="border-b border-line transition last:border-0 hover:bg-brand/5"
              >
                <td className="px-5 py-3">{p.label}</td>
                {ROLE_ORDER.map((id) => (
                  <td key={id} className="px-3 py-3">
                    {p.roles.includes(id) ? (
                      <Check
                        aria-label="Yes"
                        className="mx-auto h-4 w-4 text-brand"
                      />
                    ) : (
                      <Minus
                        aria-label="No"
                        className="mx-auto h-4 w-4 text-line"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Customers who can sign in to the customer portal
// (Inviting customers comes back when customers move to the database)
function CustomerAccess({ members, ticketCounts, actionsFor }) {
  return (
    <Card
      title="Customer portal access"
      action={
        <button
          type="button"
          disabled
          title="Coming soon, when customers move to the database"
          className="flex h-9 shrink-0 cursor-not-allowed items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Invite customer</span>
          <span className="sm:hidden">Invite</span>
        </button>
      }
    >
      <p className="-mt-2 mb-4 flex items-start gap-2 text-sm text-muted">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        Customers you invite can sign in and view only their own tickets.
        Inviting customers switches on once customers are saved in the database
        (the next step).
      </p>

      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No customers have portal access yet.
        </p>
      ) : (
        <ul className="-mx-5 divide-y divide-line border-t border-line">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition hover:bg-brand/5"
            >
              <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                <Avatar name={displayName(m)} photo={m.photo} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{displayName(m)}</p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  {m.company ?? "Individual"}
                </span>
                <span className="whitespace-nowrap text-muted">
                  {ticketCounts[m.customerId] ?? 0} ticket
                  {ticketCounts[m.customerId] === 1 ? "" : "s"}
                </span>
                <StatusText member={m} />
              </div>
              <div className="ml-auto">{actionsFor(m)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Team() {
  const { me, team, tickets, customers, newInviteLink, removeMember } =
    useData();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  // Which modal is open: { type: "invite" } /
  // { type: "edit", member } / { type: "remove", member }
  const [modal, setModal] = useState(null);
  // Shows "Copied" for a moment after copying an invite link
  const [copiedId, setCopiedId] = useState(null);

  // Staff and customers are shown in separate sections
  const staff = team.filter((m) => m.role !== "customer");
  const portalCustomers = team
    .filter((m) => m.role === "customer")
    .map((m) => ({
      ...m,
      company: customers.find((c) => c.id === m.customerId)?.company ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const active = staff.filter((m) => m.status === "active");
  const invited = staff.filter((m) => m.status === "invited");
  const counts = {
    all: staff.length,
    active: active.length,
    invited: invited.length,
  };

  // How many unfinished tickets each person has: { a1: 12, ... }
  const openTickets = {};
  // How many tickets each customer has: { 1001: 4, ... }
  const customerTickets = {};
  for (const t of tickets) {
    if (t.assignee && !isDone(t))
      openTickets[t.assignee] = (openTickets[t.assignee] ?? 0) + 1;
    customerTickets[t.customerId] = (customerTickets[t.customerId] ?? 0) + 1;
  }

  const text = query.trim().toLowerCase();
  const shown = staff
    .filter((m) => filter === "all" || m.status === filter)
    .filter(
      (m) =>
        !text ||
        [m.name, m.email, ROLES[m.role].label].some((f) =>
          f.toLowerCase().includes(text),
        ),
    )
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        displayName(a).localeCompare(displayName(b)),
    );

  // A fresh invite link from the server, copied to send yourself
  async function copyInviteLink(member) {
    try {
      const token = await newInviteLink(member.id);
      if (await copyText(inviteLinkFor(token), "Copy this invite link:")) {
        setCopiedId(member.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (err) {
      window.alert(err.message);
    }
  }

  // The same buttons are used in the table and on the phone cards
  function actionsFor(member) {
    return (
      <MemberActions
        member={member}
        allowed={canManage(me.role, member)}
        justCopied={copiedId === member.id}
        onEdit={() => setModal({ type: "edit", member })}
        onCopyLink={() => copyInviteLink(member)}
        onRemove={() => setModal({ type: "remove", member })}
      />
    );
  }

  // Their photo, or initials if they don't have one
  function avatarFor(member) {
    return <Avatar name={displayName(member)} photo={member.photo} />;
  }

  // Their name + a "You" tag if this is the logged-in user
  function nameFor(member) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{displayName(member)}</span>
        {member.id === me.id && (
          <span className="shrink-0 rounded bg-page px-1.5 py-0.5 text-xs text-muted">
            You
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Team</h1>
          <p className="mt-1 text-sm text-muted">
            Invite staff and customers, choose what they can do, and remove
            access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: "invite" })}
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand/90 active:scale-[0.97] sm:w-auto"
        >
          <UserPlus className="h-4 w-4" />
          Invite member
        </button>
      </div>

      {/* Numbers at a glance */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Members" value={active.length} icon={Users} />
        <StatCard
          label="Admins"
          value={
            active.filter((m) => m.role === "admin" || m.role === "owner")
              .length
          }
          icon={ShieldCheck}
        />
        <StatCard
          label="Agents"
          value={active.filter((m) => m.role === "agent").length}
          icon={Headset}
        />
        <StatCard
          label="Pending invites"
          value={invited.length}
          icon={MailQuestion}
        />
      </div>

      {/* Search and filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or role"
            className={`${inputClass} pl-9`}
          />
        </div>
        <div className="flex rounded-lg border border-line bg-white p-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 transition active:scale-[0.97] sm:flex-none ${
                filter === f.id
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-line bg-white px-6 py-12 text-center text-sm text-muted">
          {text ? "Nobody matches your search." : "Nobody here yet."}
        </div>
      ) : (
        <>
          {/* Desktop and tablet: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-200 text-left text-sm">
              <thead>
                <tr className="whitespace-nowrap border-b border-line text-muted">
                  <th className="px-5 py-3 font-medium">Member</th>
                  <th className="px-5 py-3 font-medium">Access</th>
                  <th className="px-5 py-3 font-medium">Departments</th>
                  <th className="px-5 py-3 font-medium">Open tickets</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-line transition last:border-0 hover:bg-brand/5"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {avatarFor(m)}
                        <div className="min-w-0">
                          {nameFor(m)}
                          {m.name && (
                            <a
                              href={`mailto:${m.email}`}
                              className="block text-xs text-muted hover:text-brand"
                            >
                              {m.email}
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleBadge role={m.role} />
                      {m.title && (
                        <p className="mt-1 max-w-48 truncate text-xs text-muted">
                          {m.title}
                        </p>
                      )}
                    </td>
                    <td className="max-w-64 px-5 py-3">
                      <TeamList departments={m.departments} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      {m.status === "active" ? (openTickets[m.id] ?? 0) : "–"}
                    </td>
                    <td className="px-5 py-3">
                      <StatusText member={m} />
                    </td>
                    <td className="px-3 py-3">{actionsFor(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {shown.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-line bg-white p-4 transition duration-200 hover:border-brand/30 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  {avatarFor(m)}
                  <div className="min-w-0 flex-1">
                    {nameFor(m)}
                    {m.name && (
                      <p className="truncate text-sm text-muted">{m.email}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <RoleBadge role={m.role} />
                      {m.title && (
                        <span className="text-xs text-muted">{m.title}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                  <TeamList departments={m.departments} />
                  {/* The buttons sit down here on phones, so the name and
                      email get the full width up top */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <StatusText member={m} />
                      {m.status === "active" && (
                        <span className="text-xs text-muted">
                          {openTickets[m.id] ?? 0} open tickets
                        </span>
                      )}
                    </div>
                    <div className="-mr-2 shrink-0">{actionsFor(m)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <DepartmentsCard />

      <CustomerAccess
        members={portalCustomers}
        ticketCounts={customerTickets}
        actionsFor={actionsFor}
      />

      <PermissionsTable />

      {modal?.type === "invite" && (
        <MemberModal onClose={() => setModal(null)} />
      )}
      {modal?.type === "edit" && (
        <MemberModal member={modal.member} onClose={() => setModal(null)} />
      )}
      {modal?.type === "remove" && (
        <RemoveModal
          member={modal.member}
          openTickets={openTickets[modal.member.id] ?? 0}
          onConfirm={() => removeMember(modal.member.id)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
