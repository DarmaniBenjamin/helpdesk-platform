// Settings for drizzle-kit, the tool that creates and updates the
// database tables from src/db/schema.js
import { defineConfig } from "drizzle-kit";

// Read DATABASE_URL from .env (built into Node, no extra package needed)
try {
  process.loadEnvFile("./.env");
} catch {
  // No .env file: DATABASE_URL must already be set some other way
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.js",
  out: "./drizzle", // where migration files are saved
  dbCredentials: { url: process.env.DATABASE_URL },
});
