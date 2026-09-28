import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES, pageCount } from "./paging";

// The page numbers to show, with "…" for gaps, e.g. 1 … 4 5 6 … 20.
// Always the first and last page, and the ones next to the current one.
function pageNumbers(page, pages) {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const list = [...wanted]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  const result = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) result.push(`gap-${n}`);
    result.push(n);
  });
  return result;
}

const pageButton =
  "flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-lg px-2 text-sm transition active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40";

// The bar under a list: "Showing 31-60 of 245", page numbers, and how
// many to show per page. `page` starts at 1.
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  what = "items",
}) {
  const pages = pageCount(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {first}–{last} of {total} {what}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-9 cursor-pointer rounded-lg border border-line bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => onPage(page - 1)}
              className={`${pageButton} text-muted hover:bg-brand/10 hover:text-brand`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pageNumbers(page, pages).map((n) =>
              typeof n === "string" ? (
                <span key={n} className="px-1 text-sm text-muted">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-current={n === page ? "page" : undefined}
                  onClick={() => onPage(n)}
                  className={`${pageButton} ${
                    n === page
                      ? "bg-brand font-medium text-white"
                      : "text-muted hover:bg-brand/10 hover:text-brand"
                  }`}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              aria-label="Next page"
              disabled={page === pages}
              onClick={() => onPage(page + 1)}
              className={`${pageButton} text-muted hover:bg-brand/10 hover:text-brand`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
