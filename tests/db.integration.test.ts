import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { splitSql } from "@/lib/db/migrate";
import { seedSample } from "@/lib/db/seed";
import { executeRun } from "@/lib/pipeline/execute";
import type { Query } from "@/lib/db/server";

// Real Postgres (WASM), so the migration SQL, upserts and JSON inserts are genuinely exercised.
let pg: PGlite;
let query: Query;
const sampleDir = fileURLToPath(new URL("../data/sample", import.meta.url));

beforeAll(async () => {
  pg = new PGlite();
  query = async (text, params = []) => (await pg.query(text, params)).rows as Record<string, unknown>[];
  const migration = readFileSync(new URL("../db/migrations/0001_init.sql", import.meta.url), "utf8");
  for (const stmt of splitSql(migration)) await pg.exec(stmt);
});

describe("database", () => {
  it("seeds the sample files and is idempotent", async () => {
    const first = await seedSample(query, sampleDir);
    expect(first).toEqual({ skus: 15, weekly_sales: 240, stock_snapshots: 15 });
    await seedSample(query, sampleDir); // re-run must not duplicate or fail
    const rows = await query("select count(*)::int as n from weekly_sales");
    expect(rows[0]!.n).toBe(240);
  });

  it("executeRun saves a done run with 15 recommendations", async () => {
    const { runId, summary } = await executeRun("manual", query);
    expect(summary.total).toBe(15);
    const [run] = await query("select status, rules_version, summary from runs where id = $1", [runId]);
    expect(run!.status).toBe("done");
    const recs = await query(
      "select sku_id, status, recommended_qty, review_state, reasons from recommendations where run_id = $1 order by sku_id",
      [runId],
    );
    expect(recs).toHaveLength(15);
    const sku001 = recs.find((r) => r.sku_id === "SKU001")!;
    expect(sku001.recommended_qty).toBe(750);
    expect(sku001.review_state).toBe("auto");
    expect(Array.isArray(sku001.reasons)).toBe(true);
  });

  it("marks the run failed with an error when something breaks", async () => {
    await query("update skus set active = false");
    await expect(executeRun("manual", query)).rejects.toThrow(/No active SKUs/);
    const [run] = await query("select status, error from runs order by started_at desc, id limit 1");
    expect(run!.status).toBe("failed");
    expect(String(run!.error)).toMatch(/No active SKUs/);
  });

  it("requires a reason when a recommendation is overridden", async () => {
    await query("update skus set active = true");
    const { runId } = await executeRun("manual", query);
    await expect(
      query("update recommendations set review_state = 'overridden' where run_id = $1 and sku_id = 'SKU001'", [runId]),
    ).rejects.toThrow();
    await query(
      "update recommendations set review_state = 'overridden', override_reason = 'competitor scheme', final_qty = 400 where run_id = $1 and sku_id = 'SKU001'",
      [runId],
    );
  });
});
