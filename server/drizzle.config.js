// Settings for drizzle-kit, the tool that creates and updates the
// database tables from src/db/schema.js
import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./src/config.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.js",
  out: "./drizzle", // where migration files are saved
  dbCredentials: { url: databaseUrl() }, // .env and DB_* parts: src/config.js
});
