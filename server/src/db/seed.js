// Puts the starting data into a new, empty database:
//   - your four departments
//   - the Super Admin account (from SUPER_ADMIN_* in .env)
//   - the default settings
// Safe to run more than once: anything already there is left alone.
//
// Run with: npm run db:seed
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "./index.js";
import { departments, users, settings } from "./schema.js";

const STARTING_DEPARTMENTS = [
  { id: "managed", name: "Managed Services" },
  { id: "support", name: "Support" },
  { id: "media", name: "Web + Media" },
  { id: "security", name: "Security / Installation" },
];

const STARTING_SETTINGS = {
  backup: { destination: "download", schedule: "daily", keep: 14 },
  freshdesk: { domain: "" },
};

async function seed() {
  // 1. Departments
  await db
    .insert(departments)
    .values(STARTING_DEPARTMENTS)
    .onConflictDoNothing();
  console.log(`✓ Departments: ${STARTING_DEPARTMENTS.length}`);

  // 2. The Super Admin
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.SUPER_ADMIN_NAME?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !name || !password) {
    throw new Error(
      "Set SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME and SUPER_ADMIN_PASSWORD in .env first.",
    );
  }
  if (password.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (existing) {
    console.log(`✓ Super Admin already exists: ${email}`);
  } else {
    // The password is scrambled ("hashed") before it's stored. 12 = how
    // much work that takes; slower for attackers trying to guess it.
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    await db.insert(users).values({
      name,
      email,
      role: "owner",
      status: "active",
      passwordHash,
      joinedAt: now,
      lastActiveAt: now,
    });
    console.log(`✓ Super Admin created: ${email}`);
  }

  // 3. Settings
  await db
    .insert(settings)
    .values(
      Object.entries(STARTING_SETTINGS).map(([key, value]) => ({ key, value })),
    )
    .onConflictDoNothing();
  console.log("✓ Settings");
}

try {
  await seed();
  console.log("Done.");
} catch (err) {
  console.error("Seeding failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end(); // close the connection so the command finishes
}
