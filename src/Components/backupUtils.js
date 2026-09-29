// Helpers for reading and saving JSON files in the browser (used by the
// Freshdesk import and Backup & Restore)

// Downloads any data as a .json file
export function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Reads a picked file and turns it into data. Rejects if it isn't JSON.
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error(`${file.name} isn't a valid JSON file.`));
      }
    };
    reader.onerror = () => reject(new Error(`${file.name} couldn't be read.`));
    reader.readAsText(file);
  });
}

// "4.2 MB", "830 KB"
export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// What's inside a backup file (made by server/src/backup.js), to show
// before restoring it. Returns null if it isn't one of our backups.
export function backupContents(backup) {
  if (backup?.app !== "helpdesk-platform" || !backup.tables) return null;
  const count = (table) => backup.tables[table]?.length ?? 0;
  return {
    exportedAt: backup.exportedAt,
    version: backup.version,
    items: [
      { label: "Tickets", count: count("tickets") },
      { label: "Customers", count: count("customers") },
      {
        label: "Team members",
        count: (backup.tables.users ?? []).filter((u) => u.role !== "customer")
          .length,
      },
      { label: "Knowledge Base answers", count: count("answers") },
      { label: "Assignment rules", count: count("rules") },
      { label: "Automations", count: count("automations") },
    ],
  };
}
