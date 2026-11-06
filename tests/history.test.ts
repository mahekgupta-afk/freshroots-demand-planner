import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { freshDb } from "./helpers/db";
import { seedSample } from "@/lib/db/seed";
import { executeRun } from "@/lib/pipeline/execute";
import { getRuns, getSkuDetail } from "@/lib/data/history";
import { decide } from "@/lib/review/decide";
import type { Query } from "@/lib/db/server";

let query: Query;
const noAi = { triage: async () => [], notify: null };

beforeAll(async () => {
  ({ query } = await freshDb());
  await seedSample(query, fileURLToPath(new URL("../data/sample", import.meta.url)));
  await query("insert into skus (sku_id, name, perishable, std_qty) values ('NEW1', 'New Launch', false, 200)");
  for (const [i, w] of ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].entries()) {
    await query("insert into weekly_sales (sku_id, week_start, qty) values ('NEW1', $1, $2)", [w, 40 + i]);
  }
  await query("insert into stock_snapshots (sku_id, snapshot_date, on_hand) values ('NEW1', '2026-10-19', 100)");
  await executeRun("cron", query, noAi);
  await executeRun("manual", query, noAi);
});

describe("getRuns", () => {
  it("lists runs newest first with counts, AI and email outcomes parsed", async () => {
    const runs = await getRuns(query);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.trigger).toBe("manual");
    expect(runs[1]).toMatchObject({ trigger: "cron", status: "done", stock_as_of: "2026-10-19" });
    expect(runs[1]!.counts).toMatchObject({ stockout: 5 });
    expect(runs[1]!.notify).toMatchObject({ sent: false });
    expect(runs[1]!.ai).toMatchObject({ attempted: 0 });
  });
  it("shows the error for a failed run", async () => {
    await query("insert into runs (planning_month, rules_version, trigger, status, error) values (10, 'v', 'cron', 'failed', 'stock.csv: stale')");
    const failed = (await getRuns(query)).find((r) => r.status === "failed")!;
    expect(failed).toMatchObject({ error: "stock.csv: stale", counts: null });
  });
  it("respects the limit", async () => {
    expect(await getRuns(query, 1)).toHaveLength(1);
  });
});

describe("getSkuDetail", () => {
  it("returns null for an unknown SKU", async () => {
    expect(await getSkuDetail(query, "NOPE")).toBeNull();
  });
  it("returns master data, 16 weeks oldest-first, and history newest-first", async () => {
    const d = (await getSkuDetail(query, "SKU001"))!;
    expect(d.sku).toMatchObject({ sku_id: "SKU001", perishable: false, std_qty: 500 });
    expect(d.weeks).toHaveLength(16);
    expect(d.weeks[0]!.week_start < d.weeks[15]!.week_start).toBe(true);
    expect(d.history).toHaveLength(2);
    expect(d.history[0]!.run_at >= d.history[1]!.run_at).toBe(true);
    expect(d.history[0]).toMatchObject({ status: "stockout", recommended_qty: 750 });
    expect(typeof d.history[0]!.avg_12wk).toBe("number");
    expect(Array.isArray(d.history[0]!.reasons)).toBe(true);
  });
  it("includes the decision and who made it", async () => {
    const [u] = await query("insert into profiles (email, full_name, role) values ('r@x.test', 'Raghav', 'planner') returning id");
    const [rec] = await query("select rec.id from recommendations rec join runs r on r.id = rec.run_id where rec.sku_id = 'NEW1' order by r.started_at desc limit 1");
    await decide(query, { action: "override", recId: String(rec!.id), userId: String(u!.id), finalQty: 60, reason: "Slow start" });
    const d = (await getSkuDetail(query, "NEW1"))!;
    expect(d.history[0]).toMatchObject({ review_state: "overridden", final_qty: 60, override_reason: "Slow start", decided_by_name: "Raghav" });
  });
  it("ignores runs that did not finish", async () => {
    const before = (await getSkuDetail(query, "SKU001"))!.history.length;
    const [run] = await query("insert into runs (planning_month, rules_version, trigger, status) values (10, 'v', 'cron', 'failed') returning id");
    await query("insert into recommendations (run_id, sku_id, status, rule_status) values ($1, 'SKU001', 'on_track', 'on_track')", [run!.id]);
    expect((await getSkuDetail(query, "SKU001"))!.history).toHaveLength(before);
  });
});
