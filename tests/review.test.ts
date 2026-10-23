import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { splitSql } from "@/lib/db/migrate";
import { seedSample } from "@/lib/db/seed";
import { executeRun } from "@/lib/pipeline/execute";
import { getLatestRun } from "@/lib/data/latest";
import { decide } from "@/lib/review/decide";
import type { Query } from "@/lib/db/server";

let query: Query;
let userId: string;
const sampleDir = fileURLToPath(new URL("../data/sample", import.meta.url));

async function pendingIds() {
  const latest = (await getLatestRun(query))!;
  return latest.recs.filter((r) => r.review_state === "pending").map((r) => r.id);
}

beforeAll(async () => {
  const pg = new PGlite();
  query = async (t, p = []) => (await pg.query(t, p)).rows as Record<string, unknown>[];
  for (const f of ["0001_init.sql", "0002_auth.sql"]) {
    for (const s of splitSql(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"))) await pg.exec(s);
  }
  await seedSample(query, sampleDir);
  // A new launch with only 6 weeks of history: the rules must route it to review.
  await query("insert into skus (sku_id, name, perishable, std_qty) values ('NEW001', 'New Launch Bar', false, 200)");
  for (const [i, w] of ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].entries()) {
    await query("insert into weekly_sales (sku_id, week_start, qty) values ('NEW001', $1, $2)", [w, 40 + i]);
  }
  await query("insert into stock_snapshots (sku_id, snapshot_date, on_hand) values ('NEW001', '2026-10-19', 100)");
  const [u] = await query("insert into profiles (email, full_name, role) values ('raghav@freshroots.test', 'Raghav', 'planner') returning id");
  userId = String(u!.id);
  await executeRun("manual", query);
});

describe("getLatestRun", () => {
  it("returns null before any run finishes", async () => {
    const empty = new PGlite();
    for (const s of splitSql(readFileSync(new URL("../db/migrations/0001_init.sql", import.meta.url), "utf8"))) await empty.exec(s);
    expect(await getLatestRun(async (t, p = []) => (await empty.query(t, p)).rows as Record<string, unknown>[])).toBeNull();
  });

  it("returns typed rows, most urgent first, with 12-week history", async () => {
    const { recs, summary, run } = (await getLatestRun(query))!;
    expect(recs).toHaveLength(16);
    expect(recs[0]!.status).toBe("stockout");
    const sku1 = recs.find((r) => r.sku_id === "SKU001")!;
    expect(sku1.weekly_sales).toHaveLength(12);
    expect(typeof sku1.cover_weeks).toBe("number");
    expect(Array.isArray(sku1.reasons)).toBe(true);
    expect(summary.counts.needs_review).toBe(1);
    expect(summary.pending_review).toBe(1);
    expect(run.planning_month).toBeGreaterThanOrEqual(1);
  });

  it("routes the new launch to review but keeps the rule result", async () => {
    const r = (await getLatestRun(query))!.recs.find((x) => x.sku_id === "NEW001")!;
    expect(r.status).toBe("needs_review");
    expect(r.review_state).toBe("pending");
    expect(r.review_reasons[0]).toMatch(/New launch/);
    expect(r.rule_status).not.toBe("needs_review");
  });
});

describe("decide", () => {
  it("requires a reason to override", async () => {
    const [id] = await pendingIds();
    const res = await decide(query, { action: "override", recId: id!, userId, finalQty: 50, reason: "  " });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/reason/i) });
    expect((await pendingIds())).toHaveLength(1); // nothing changed
  });

  it("rejects bad quantities", async () => {
    const [id] = await pendingIds();
    for (const q of [-1, 1.5, NaN, 2_000_000]) {
      const res = await decide(query, { action: "override", recId: id!, userId, finalQty: q, reason: "competitor scheme" });
      expect(res.ok).toBe(false);
    }
  });

  it("approve takes the rule quantity and records who and when", async () => {
    const [id] = await pendingIds();
    expect(await decide(query, { action: "approve", recId: id!, userId })).toEqual({ ok: true });
    const r = (await getLatestRun(query))!.recs.find((x) => x.id === id)!;
    expect(r.review_state).toBe("approved");
    expect(r.final_qty).toBe(r.recommended_qty);
    expect(r.decided_by_name).toBe("Raghav");
    expect(r.decided_at).not.toBeNull();
  });

  it("cannot decide the same item twice", async () => {
    const r = (await getLatestRun(query))!.recs.find((x) => x.sku_id === "NEW001")!;
    const again = await decide(query, { action: "override", recId: r.id, userId, finalQty: 10, reason: "changed my mind" });
    expect(again.ok).toBe(false);
    expect((await getLatestRun(query))!.recs.find((x) => x.sku_id === "NEW001")!.review_state).toBe("approved");
  });

  it("only one of two simultaneous decisions wins", async () => {
    await executeRun("manual", query); // fresh run with a fresh pending item
    const [id] = await pendingIds();
    const [a, b] = await Promise.all([
      decide(query, { action: "approve", recId: id!, userId }),
      decide(query, { action: "override", recId: id!, userId, finalQty: 5, reason: "both clicked" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("override stores the quantity and reason", async () => {
    await executeRun("manual", query);
    const [id] = await pendingIds();
    expect(await decide(query, { action: "override", recId: id!, userId, finalQty: 0, reason: "  distributor buying less  " })).toEqual({ ok: true });
    const r = (await getLatestRun(query))!.recs.find((x) => x.id === id)!;
    expect(r).toMatchObject({ review_state: "overridden", final_qty: 0, override_reason: "distributor buying less" });
  });

  it("will not touch an auto-decided item", async () => {
    const auto = (await getLatestRun(query))!.recs.find((x) => x.review_state === "auto")!;
    expect((await decide(query, { action: "approve", recId: auto.id, userId })).ok).toBe(false);
  });
});
