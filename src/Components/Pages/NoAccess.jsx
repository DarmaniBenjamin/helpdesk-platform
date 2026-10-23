import { Link } from "react-router";
import { Lock } from "lucide-react";
import useData from "../../useData";
import { ROLES } from "../teamRoles";

// Shown when someone opens a page their access level doesn't include,
// e.g. an agent typing /reports into the address bar
export default function NoAccess() {
  const { me } = useData();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Lock className="h-6 w-6" />
      </span>
      <h1 className="text-xl font-semibold">
        You don't have access to this page
      </h1>
      <p className="max-w-sm text-sm text-muted">
        Your access level is {ROLES[me.role].label}. If you need this page, ask
        an Admin.
      </p>
      <Link
        to="/inbox"
        className="btn-glass mt-2 flex min-h-8.5 sm:min-h-7 items-center rounded-md px-3 text-sm font-medium transition active:scale-[0.97] py-0.5 leading-5 text-center sm:text-[13px]"
      >
        Go to the Inbox
      </Link>
    </div>
  );
}
