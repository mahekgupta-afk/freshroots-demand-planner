import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { freshDb } from "./helpers/db";
import { seedSample } from "@/lib/db/seed";
import { executeRun } from "@/lib/pipeline/execute";
import { getLatestRun } from "@/lib/data/latest";
import type { Query } from "@/lib/db/server";
import type { TriageItem, TriageOutcome } from "@/lib/gemini/triage";

let query: Query;

beforeEach(async () => {
  ({ query } = await freshDb());
  await seedSample(query, fileURLToPath(new URL("../data/sample", import.meta.url)));
  await query("insert into skus (sku_id, name, perishable, std_qty) values ('NEW001', 'New Launch Bar', false, 200)");
  for (const [i, w] of ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].entries()) {
    await query("insert into weekly_sales (sku_id, week_start, qty) values ('NEW001', $1, $2)", [w, 40 + i]);
  }
  await query("insert into stock_snapshots (sku_id, snapshot_date, on_hand) values ('NEW001', '2026-10-19', 100)");
});

const ok = (items: TriageItem[]): TriageOutcome[] =>
  items.map((i) => ({ sku_id: i.sku_id, note: "Launch is young; check early sell-through.", action: "investigate", confidence: "low", failed: false }));

describe("executeRun with triage", () => {
  it("saves the AI note on the flagged SKU only and calls triage once with just that SKU", async () => {
    let seen: TriageItem[] = [];
    const { runId, summary } = await executeRun("manual", query, { triage: async (items) => { seen = items; return ok(items); } });
    expect(seen.map((i) => i.sku_id)).toEqual(["NEW001"]);
    expect(summary.ai).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    const { recs } = (await getLatestRun(query))!;
    const flagged = recs.find((r) => r.sku_id === "NEW001")!;
    expect(flagged).toMatchObject({ gemini_note: "Launch is young; check early sell-through.", gemini_action: "investigate", gemini_confidence: "low", gemini_failed: false });
    expect(recs.filter((r) => r.gemini_note !== null)).toHaveLength(1);
    void runId;
  });

  it("never lets the AI change the rule quantity", async () => {
    await executeRun("manual", query, { triage: async (items) => ok(items).map((o) => ({ ...o, note: "Order 99999 units!" })) });
    const flagged = (await getLatestRun(query))!.recs.find((r) => r.sku_id === "NEW001")!;
    expect(flagged.recommended_qty).not.toBe(99999);
    expect(flagged.final_qty).toBeNull();
    expect(flagged.review_state).toBe("pending");
  });

  it("a total AI failure does not fail the run; the SKU is flagged", async () => {
    const { summary } = await executeRun("manual", query, {
      triage: async (items) => items.map((i) => ({ sku_id: i.sku_id, note: null, action: null, confidence: null, failed: true })),
    });
    expect(summary.ai).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    const [run] = await query("select status from runs");
    expect(run!.status).toBe("done");
    const flagged = (await getLatestRun(query))!.recs.find((r) => r.sku_id === "NEW001")!;
    expect(flagged).toMatchObject({ gemini_note: null, gemini_failed: true, status: "needs_review" });
  });

  it("a triage function that throws still does not fail the run", async () => {
    await expect(executeRun("manual", query, { triage: async () => { throw new Error("boom"); } })).resolves.toBeTruthy();
    expect((await getLatestRun(query))!.recs.find((r) => r.sku_id === "NEW001")!.gemini_failed).toBe(true);
  });

  it("logs each AI call to ai_calls with the run id", async () => {
    const { runId } = await executeRun("manual", query, {
      triage: async (items, onCall) => {
        await onCall?.({ skus: items.map((i) => i.sku_id), model: "m", request: { a: 1 }, response: { b: 2 }, latency_ms: 123, error: null });
        return ok(items);
      },
    });
    const rows = await query("select run_id, model, latency_ms, request, response from ai_calls");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run_id: runId, model: "m", latency_ms: 123 });
    expect(JSON.stringify(rows[0]!.request)).toContain("NEW001");
  });

  it("skips triage quietly when no key is configured and still completes the run", async () => {
    const saved = [process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL];
    delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL;
    try {
      const { summary } = await executeRun("manual", query);
      expect(summary.ai.skipped_reason).toMatch(/not set/);
      expect((await getLatestRun(query))!.recs.find((r) => r.sku_id === "NEW001")!.gemini_failed).toBe(false);
    } finally {
      if (saved[0]) process.env.GEMINI_API_KEY = saved[0];
      if (saved[1]) process.env.GEMINI_MODEL = saved[1];
    }
  });

  it("does not call triage at all when nothing needs review", async () => {
    await query("update skus set active = false where sku_id = 'NEW001'");
    let called = false;
    await executeRun("manual", query, { triage: async (i) => { called = true; return ok(i); } });
    expect(called).toBe(false);
  });
});
