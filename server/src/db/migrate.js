// Brings the database up to date: applies any migration files in the
// drizzle folder that haven't been applied yet. Runs every time the
// server starts (npm start), so a fresh database on Render gets all its
// tables, and every update after that gets its changes, by itself.
//
// Same result as "npm run db:migrate", but it doesn't need drizzle-kit
// (a tool that's only installed for development).
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

try {
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle"),
  });
  console.log("✓ Database is up to date");
} catch (err) {
  console.error("Updating the database failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
