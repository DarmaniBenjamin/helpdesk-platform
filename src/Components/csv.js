// Shared by the pages with an Export button (Reports, Dashboard,
// Performance & Feedback)

// Text that starts like a formula (=, +, -, @) gets a ' in front, so a
// ticket titled "=HYPERLINK(...)" by a customer shows as text in Excel
// instead of running
function safe(v) {
  const text = String(v ?? "");
  return typeof v === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

// Downloads rows as a spreadsheet file (CSV)
export function downloadCsv(rows, filename) {
  // Wrap each value in quotes so commas inside names don't break the columns
  const csv = rows
    .map((row) =>
      row.map((v) => `"${safe(v).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  // "\uFEFF" at the start tells Excel the file is UTF-8, so letters like é show correctly
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Give the browser a moment to start the download before cleaning up
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
