// Helpers for backups: saving the app's data to a file and reading it back

export const BACKUP_APP = "helpdesk-platform";
export const BACKUP_VERSION = 1;

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

// "helpdesk-backup-2026-09-26-1430.json"
export function backupFileName(time = Date.now()) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return `helpdesk-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

// Checks a file really is one of our backups before anything is replaced
export function checkBackup(json) {
  if (json?.app !== BACKUP_APP || !json.data) {
    return { error: "This isn't a helpdesk backup file." };
  }
  if (json.version > BACKUP_VERSION) {
    return {
      error: "This backup is from a newer version of the app. Update first.",
    };
  }
  const { data } = json;
  if (!Array.isArray(data.tickets) || !Array.isArray(data.customers)) {
    return { error: "This backup is missing its tickets or customers." };
  }
  return { backup: json };
}

// What's inside a backup, for showing before restoring
export function backupSummary(data) {
  return [
    { label: "Tickets", count: data.tickets?.length ?? 0 },
    { label: "Customers", count: data.customers?.length ?? 0 },
    { label: "Team members", count: data.team?.length ?? 0 },
    { label: "Knowledge Base answers", count: data.answers?.length ?? 0 },
    { label: "Assignment rules", count: data.rules?.length ?? 0 },
    { label: "Automations", count: data.automations?.length ?? 0 },
  ];
}
