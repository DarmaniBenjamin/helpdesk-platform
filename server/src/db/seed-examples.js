// FOR DEVELOPMENT ONLY. Puts the app's 48 example customers into the
// database, so the example tickets (still made up in the front end) have
// real customers to belong to while you build and test.
//
// Never run this on the real database. Your real customers come from the
// Freshdesk import instead.
//
// Run with: npm run db:seed-examples
// Safe to run more than once: customers already there are left alone.
import { sql } from "drizzle-orm";
import { db, pool } from "../index.js";
import { customers } from "./schema.js";
// The same example customers the front end makes up (src/data.js)
import { customers as examples } from "../../../src/data.js";

try {
  await db
    .insert(customers)
    .values(
      examples.map((c) => ({
        id: c.id, // same numbers as the example tickets use
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company,
        createdAt: new Date(c.createdAt),
      })),
    )
    .onConflictDoNothing();

  // New customers carry on numbering after the highest one
  await db.execute(
    sql`select setval(pg_get_serial_sequence('customers', 'id'), (select max(id) from customers))`,
  );
  console.log(`✓ Example customers: ${examples.length}`);
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
