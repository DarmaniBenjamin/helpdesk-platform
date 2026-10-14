import { useState } from "react";
import useData from "../useData";
import { AGENTS, DEPARTMENTS } from "../data";

// A filter or choice that's remembered in this browser, for each person
// (so two people sharing a computer each keep their own): the Inbox's
// filters, sorting, tabs... come back the same after a refresh, or next
// time. Used like useState:
//
//   const [priority, setPriority] = useSavedState("inbox.priority", "any");
//
// isValid (optional): a saved choice that no longer makes sense (a team or
// person that was removed) shows as the default instead.
// session (optional): only remembered while this tab stays open (refreshing
// and moving between pages keep it); after the browser or tab is closed it
// starts on the default again.
export default function useSavedState(name, initial, isValid, { session = false } = {}) {
  const { me } = useData();
  const key = `filter:${me?.id ?? "anyone"}:${name}`;
  const storage = () => (session ? sessionStorage : localStorage);
  const [value, setValue] = useState(() => {
    try {
      const saved = storage().getItem(key);
      return saved === null ? initial : JSON.parse(saved);
    } catch {
      return initial; // private browsing, or something unreadable
    }
  });

  function set(next) {
    const chosen = typeof next === "function" ? next(value) : next;
    setValue(chosen);
    try {
      storage().setItem(key, JSON.stringify(chosen));
    } catch {
      // Private browsing: it just isn't remembered
    }
  }

  return [isValid && !isValid(value) ? initial : value, set];
}

const ALWAYS = ["any", "all", "none"];

// Is this still a team? (While the list is still loading, yes.)
export const isTeam = (value) =>
  ALWAYS.includes(value) || !DEPARTMENTS.length || DEPARTMENTS.some((d) => String(d.id) === String(value));

// Is this still someone on the team?
export const isAgent = (value) =>
  ALWAYS.includes(value) || !AGENTS.length || AGENTS.some((a) => String(a.id) === String(value));
