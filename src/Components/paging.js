// Splitting a long list into pages (see Pagination.jsx for the bar
// under the list).
import { useState } from "react";
import { useSearchParams } from "react-router";

// How many rows a page can show. Never more than 100.
export const PAGE_SIZES = [30, 50, 100];

// The rows for one page, e.g. rows 31-60 for page 2 at 30 per page
export function pageOf(list, page, pageSize) {
  return list.slice((page - 1) * pageSize, page * pageSize);
}

// How many pages there are (always at least 1)
export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

// For a list page like the Inbox. The page number lives in the address
// (?page=3), so opening a ticket and pressing Back returns to the same
// page. How many per page is remembered in this browser, separately for
// each list (`name`, e.g. "inbox").
// Returns { page, pageSize, setPage, setPageSize }. `page` can be past
// the end if the list got shorter, so use Math.min with pageCount.
export function usePaging(name) {
  const [params, setParams] = useSearchParams();
  const storageKey = `page-size:${name}`;

  const [pageSize, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return PAGE_SIZES.includes(saved) ? saved : PAGE_SIZES[0];
    } catch {
      return PAGE_SIZES[0];
    }
  });

  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);

  // Keeps everything else in the address (e.g. ?search=printer)
  function setPage(n) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (n > 1) next.set("page", String(n));
        else next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  function setPageSize(size) {
    setSize(size);
    try {
      localStorage.setItem(storageKey, String(size));
    } catch {
      // Private browsing: it just isn't remembered
    }
    setPage(1);
  }

  return { page, pageSize, setPage, setPageSize };
}
