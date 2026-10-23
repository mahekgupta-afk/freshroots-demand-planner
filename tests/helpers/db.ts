import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { splitSql } from "@/lib/db/migrate";
import type { Query } from "@/lib/db/server";

const migrationsDir = fileURLToPath(new URL("../../db/migrations", import.meta.url));

/** In-memory Postgres with every migration applied, in order, exactly as `npm run migrate` does. */
export async function freshDb(): Promise<{ pg: PGlite; query: Query }> {
  const pg = new PGlite();
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of splitSql(readFileSync(`${migrationsDir}/${f}`, "utf8"))) await pg.exec(s);
  }
  const query: Query = async (text, params = []) => (await pg.query(text, params)).rows as Record<string, unknown>[];
  return { pg, query };
}
