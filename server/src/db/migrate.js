// Brings the database up to date: applies any migration files in the
// drizzle folder that haven't been applied yet. Runs every time the
// server starts (npm start), so a fresh database on Render gets all its
// tables, and every update after that gets its changes, by itself.
//
// Same result as "npm run db:migrate", but it doesn't need drizzle-kit
// (a tool that's only installed for development).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";
import { explainDatabaseError } from "../config.js";

// The migration files name the "public" area. With DB_SCHEMA (see
// start.js), a copy of them naming that area instead is used.
function migrationsFolder() {
  const folder = path.resolve(import.meta.dirname, "../../drizzle");
  const schema = process.env.DB_SCHEMA;
  if (!schema) return folder;
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "uplink-migrations-"));
  fs.cpSync(folder, copy, { recursive: true });
  for (const file of fs.readdirSync(copy).filter((f) => f.endsWith(".sql"))) {
    const where = path.join(copy, file);
    fs.writeFileSync(
      where,
      fs.readFileSync(where, "utf8").replaceAll('"public".', `"${schema}".`),
    );
  }
  return copy;
}

try {
  await migrate(db, { migrationsFolder: migrationsFolder() });
  console.log("✓ Database is up to date");
} catch (err) {
  // Drizzle wraps the database's own error (err.cause), which says why
  console.error("Updating the database failed:", err.message);
  console.error(explainDatabaseError(err.cause ?? err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
