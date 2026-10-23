// Applies db/migrations/*.sql in order. Tracks applied files in a schema_migrations table.
// Usage: npm run migrate   (reads DATABASE_URL from .env.local)
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { splitSql } from "../src/lib/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env.local first.");
  process.exit(1);
}
const sql = neon(url);
const dir = fileURLToPath(new URL("../db/migrations", import.meta.url));

await sql.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())");
const done = new Set((await sql.query("select name from schema_migrations")).map((r) => r.name as string));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) { console.log(`skip ${file}`); continue; }
  const statements = splitSql(readFileSync(`${dir}/${file}`, "utf8"));
  // One atomic request: all statements and the bookkeeping row succeed or none do.
  await sql.transaction([
    ...statements.map((s) => sql.query(s)),
    sql.query("insert into schema_migrations (name) values ($1)", [file]),
  ]);
  console.log(`applied ${file} (${statements.length} statements)`);
}
