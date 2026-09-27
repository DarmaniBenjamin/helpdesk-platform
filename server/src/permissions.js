// Who is allowed to do what. The same rules as the front end's
// src/Components/teamRoles.js, but checked here on the server, so nobody
// can get around them by changing the page.
//   owner = Super Admin, admin = Admin, agent = Agent, customer = Customer

export const STAFF = ["owner", "admin", "agent"];
export const ADMINS = ["owner", "admin"];

// Which access levels someone can give when inviting or editing.
// Only the Super Admin can make Admins.
export function pickableRoles(myRole) {
  if (myRole === "owner") return ["admin", "agent"];
  if (myRole === "admin") return ["agent"];
  return [];
}

// Can this person change or remove that one? The Super Admin can manage
// everyone else; Admins can manage agents and customers, not other Admins.
// Nobody manages the Super Admin, and you manage yourself on My profile.
export function canManage(me, target) {
  if (target.id === me.id || target.role === "owner") return false;
  if (target.role === "admin") return me.role === "owner";
  return ADMINS.includes(me.role);
}
