// Loads data/sample into Postgres. Safe to re-run (upserts).
// Usage: npm run seed      (reads DATABASE_URL from .env.local)
import { neonQuery } from "../src/lib/db/server";
import { fileURLToPath } from "node:url";
import { seedSample } from "../src/lib/db/seed";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL in .env.local first.");
  process.exit(1);
}
const counts = await seedSample(neonQuery(), fileURLToPath(new URL("../data/sample", import.meta.url)));
console.log("Seed complete:", counts);
