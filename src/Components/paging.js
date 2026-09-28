// Splitting a long list into pages (see Pagination.jsx for the bar
// under the list).

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
