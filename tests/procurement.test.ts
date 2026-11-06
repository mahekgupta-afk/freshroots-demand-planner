import { describe, it, expect } from "vitest";
import { stockAgeDays, isStale, requireFreshData } from "@/lib/data/freshness";
import { csvField, toCsv } from "@/lib/csv";
import { buildProcurementList } from "@/lib/data/procurement";
import type { RecRow } from "@/lib/data/latest";

describe("stockAgeDays", () => {
  it("counts calendar days in India time", () => {
    expect(stockAgeDays("2026-10-19", new Date("2026-10-19T05:00:00Z"))).toBe(0);
    expect(stockAgeDays("2026-10-19", new Date("2026-10-22T05:00:00Z"))).toBe(3);
    expect(stockAgeDays("2026-10-19", new Date("2026-11-06T05:00:00Z"))).toBe(18);
  });
  it("rolls to the next day at midnight IST, not midnight UTC", () => {
    // 19:00 UTC on the 19th is 00:30 IST on the 20th.
    expect(stockAgeDays("2026-10-19", new Date("2026-10-19T19:00:00Z"))).toBe(1);
    expect(stockAgeDays("2026-10-19", new Date("2026-10-19T17:00:00Z"))).toBe(0);
  });
  it("accepts a timestamp and returns null when there is no date", () => {
    expect(stockAgeDays("2026-10-19 00:00:00+00", new Date("2026-10-20T05:00:00Z"))).toBe(1);
    expect(stockAgeDays(null)).toBeNull();
    expect(stockAgeDays("garbage")).toBeNull();
  });
  it("treats more than 2 days, or no date, as stale", () => {
    expect(isStale(2)).toBe(false);
    expect(isStale(3)).toBe(true);
    expect(isStale(null)).toBe(true);
  });
  it("strict mode is opt-in", () => {
    expect(requireFreshData({})).toBe(false);
    expect(requireFreshData({ REQUIRE_FRESH_DATA: "true" })).toBe(true);
    expect(requireFreshData({ REQUIRE_FRESH_DATA: "yes" })).toBe(false);
  });
});

describe("csv", () => {
  it("quotes fields with commas, quotes and newlines", () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(0)).toBe("0");
  });
  it("neutralises spreadsheet formulas in text but leaves real numbers alone", () => {
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvField("+cmd")).toBe("'+cmd");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField(-5)).toBe("-5");
  });
  it("builds header and rows", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"], [2, ""]])).toBe('a,b\n1,"x,y"\n2,');
  });
});

const rec = (over: Partial<RecRow>): RecRow => ({
  id: over.sku_id ?? "id", sku_id: "S", name: "Item", perishable: false, status: "on_track", rule_status: "on_track",
  effective_stock: 100, weekly_demand: 10, cover_weeks: 10, recommended_qty: null, reasons: ["Cover is fine."], review_reasons: [],
  review_state: "auto", final_qty: null, override_reason: null, decided_by_name: null, decided_at: null,
  gemini_note: null, gemini_confidence: null, gemini_action: null, gemini_failed: false, weekly_sales: [], ...over,
});

describe("buildProcurementList", () => {
  const recs: RecRow[] = [
    rec({ sku_id: "OVER", status: "overstock", rule_status: "overstock", recommended_qty: 0, reasons: ["Too much."] }),
    rec({ sku_id: "OUT", status: "stockout", rule_status: "stockout", recommended_qty: 500, reasons: ["Below minimum."] }),
    rec({ sku_id: "OK", status: "on_track" }),
    rec({ sku_id: "WAIT", status: "needs_review", rule_status: "stockout", recommended_qty: 200, review_state: "pending" }),
    rec({ sku_id: "APP", status: "needs_review", rule_status: "stockout", recommended_qty: 200, review_state: "approved", final_qty: 200, decided_by_name: "Raghav" }),
    rec({ sku_id: "OVR", status: "needs_review", rule_status: "stockout", recommended_qty: 200, review_state: "overridden", final_qty: 50, decided_by_name: "Raghav", override_reason: "Slow launch" }),
    rec({ sku_id: "PAUSED", status: "needs_review", rule_status: "stockout", recommended_qty: 200, review_state: "overridden", final_qty: 0, decided_by_name: "Raghav", override_reason: "Delisting" }),
    rec({ sku_id: "NOACT", status: "needs_review", rule_status: "on_track", recommended_qty: null, review_state: "approved", final_qty: null, decided_by_name: "Raghav" }),
  ];
  const { items, waitingForReview } = buildProcurementList(recs);
  const by = Object.fromEntries(items.map((i) => [i.sku_id, i]));

  it("holds back items waiting for review and counts them", () => {
    expect(waitingForReview).toBe(1);
    expect(by.WAIT).toBeUndefined();
  });
  it("omits on-track and no-action items", () => {
    expect(by.OK).toBeUndefined();
    expect(by.NOACT).toBeUndefined();
  });
  it("uses the rule quantity for rule-decided items", () => {
    expect(by.OUT).toMatchObject({ action: "order", qty: 500, source: "rules", decided_by: null, reason: "Below minimum." });
    expect(by.OVER).toMatchObject({ action: "pause", qty: 0, source: "rules" });
  });
  it("uses the planner's final quantity, never the rule quantity, once decided", () => {
    expect(by.APP).toMatchObject({ qty: 200, source: "approved", decided_by: "Raghav" });
    expect(by.OVR).toMatchObject({ action: "order", qty: 50, source: "overridden", reason: "Slow launch" });
    expect(by.PAUSED).toMatchObject({ action: "pause", qty: 0, reason: "Delisting" });
  });
  it("lists orders before pauses", () => {
    const actions = items.map((i) => i.action);
    expect(actions.indexOf("pause")).toBeGreaterThan(actions.lastIndexOf("order"));
  });
});
