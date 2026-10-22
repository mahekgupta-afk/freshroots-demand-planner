import { describe, it, expect } from "vitest";
import { loadSampleRun } from "@/lib/data/sample";
import { planningMonthIST } from "@/lib/pipeline/run";

describe("pipeline on sample data", () => {
  const oct = new Date("2026-10-22T01:30:00Z");
  const { planned, summary } = loadSampleRun(oct);

  it("evaluates every SKU and counts add up", () => {
    expect(planned).toHaveLength(15);
    expect(Object.values(summary.counts).reduce((a, b) => a + b, 0)).toBe(15);
  });
  it("sorts stockouts first", () => {
    expect(planned[0]!.status).toBe("stockout");
  });
  it("uses the latest stock snapshot and a 12-week window", () => {
    expect(summary.stock_as_of).toBe("2026-10-19");
    expect(planned.every((p) => p.weekly_sales.length === 12)).toBe(true);
  });
  it("matches the known October results", () => {
    const by = Object.fromEntries(planned.map((p) => [p.sku_id, p]));
    expect(by.SKU001!.recommended_qty).toBe(750);
    expect(by.SKU006!.status).toBe("overstock");
    expect(summary.festival_month).toBe(true);
  });
});

describe("planningMonthIST", () => {
  it("uses India time at a month boundary", () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in IST.
    expect(planningMonthIST(new Date("2026-10-31T20:00:00Z"))).toBe(11);
    expect(planningMonthIST(new Date("2026-10-31T10:00:00Z"))).toBe(10);
  });
});
