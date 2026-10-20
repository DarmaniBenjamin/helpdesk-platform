// The connection to the database, shared by the whole server.
// DATABASE_URL (or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) comes from the
// environment variables or a .env file (see config.js).
import "../config.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "No database is set: add DB_HOST, DB_NAME, DB_USER and DB_PASSWORD (or DATABASE_URL) to the environment variables, or copy .env.example to .env and fill it in.",
  );
}

// A "pool" keeps a few connections open and reuses them, which is much
// faster than connecting again for every request
// DB_SCHEMA: the tables are in their own area of the database instead of
// "public" (start.js picks it on hosts that don't allow "public")
const schemaName = process.env.DB_SCHEMA;
if (schemaName && !/^[a-z_][a-z0-9_]*$/.test(schemaName))
  throw new Error("DB_SCHEMA can only have small letters, numbers and _.");
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(schemaName ? { options: `-c search_path=${schemaName},public` } : {}),
});

export const db = drizzle(pool, { schema });
