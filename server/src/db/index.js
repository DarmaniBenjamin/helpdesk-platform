// The connection to the database, shared by the whole server.
// DATABASE_URL comes from the .env file in this folder.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env and fill it in.",
  );
}

// A "pool" keeps a few connections open and reuses them, which is much
// faster than connecting again for every request
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
