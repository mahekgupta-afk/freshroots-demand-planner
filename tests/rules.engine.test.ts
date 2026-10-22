import { describe, it, expect } from "vitest";
import rulesJson from "../config/rules.json";
import { rulesSchema } from "@/lib/rules/schema";
import { evaluateSku, type SkuInput } from "@/lib/rules/engine";

const rules = rulesSchema.parse(rulesJson);
const flat = (n: number, len = 12) => Array<number>(len).fill(n);

function sku(over: Partial<SkuInput> = {}): SkuInput {
  return {
    sku_id: "SKU1",
    perishable: false,
    std_qty: 500,
    weekly_sales: flat(100),
    weeks_history: 12,
    on_hand: 1000,
    open_po_qty: 0,
    planning_month: 5, // May: not a festival month
    ...over,
  };
}

describe("rules.json", () => {
  it("matches the schema", () => {
    expect(rulesSchema.safeParse(rulesJson).success).toBe(true);
  });
  it("rejects an inverted cover band", () => {
    const bad = { ...rulesJson, cover_weeks: { ...rulesJson.cover_weeks, standard: { min: 14, max: 6 } } };
    expect(rulesSchema.safeParse(bad).success).toBe(false);
  });
});

describe("standard SKU cover bands", () => {
  it("mid-band cover is on_track with no action", () => {
    const r = evaluateSku(sku({ on_hand: 1000 }), rules); // 10 weeks
    expect(r.status).toBe("on_track");
    expect(r.recommended_qty).toBeNull();
  });
  it("cover just below 6 weeks is stockout at std_qty", () => {
    const r = evaluateSku(sku({ on_hand: 590 }), rules);
    expect(r.status).toBe("stockout");
    expect(r.recommended_qty).toBe(500);
  });
  it("cover exactly 6 weeks is on_track (min is inclusive)", () => {
    expect(evaluateSku(sku({ on_hand: 600 }), rules).status).toBe("on_track");
  });
  it("cover exactly 14 weeks is on_track (max is inclusive)", () => {
    expect(evaluateSku(sku({ on_hand: 1400 }), rules).status).toBe("on_track");
  });
  it("cover above 14 weeks is overstock and paused", () => {
    const r = evaluateSku(sku({ on_hand: 1410 }), rules);
    expect(r.status).toBe("overstock");
    expect(r.recommended_qty).toBe(0);
  });
});

describe("high demand", () => {
  // avg 103.33, last 4 weeks 130 (> 1.2 x avg). Low CV, no sudden drop.
  const rising = [...flat(90, 8), ...flat(130, 4)];

  it("last 4 weeks 20%+ above average is high_demand at 1.5x", () => {
    const r = evaluateSku(sku({ weekly_sales: rising, on_hand: 1000 }), rules);
    expect(r.status).toBe("high_demand");
    expect(r.recommended_qty).toBe(750);
  });
  it("exactly 20% above is not high demand (strictly greater)", () => {
    const s = [...flat(100, 8), ...flat(100, 4)];
    expect(evaluateSku(sku({ weekly_sales: s }), rules).status).toBe("on_track");
  });
  it("stockout and high demand together order 1.5x", () => {
    const r = evaluateSku(sku({ weekly_sales: rising, on_hand: 300 }), rules);
    expect(r.status).toBe("stockout");
    expect(r.recommended_qty).toBe(750);
  });
  it("overstock beats high demand", () => {
    const r = evaluateSku(sku({ weekly_sales: rising, on_hand: 2000 }), rules);
    expect(r.status).toBe("overstock");
    expect(r.recommended_qty).toBe(0);
  });
  it("uses raw sales, not uplifted demand, for the high-demand test", () => {
    // Festival month must not turn a flat SKU into high_demand.
    const r = evaluateSku(sku({ planning_month: 10, on_hand: 1000 }), rules);
    expect(r.status).not.toBe("high_demand");
  });
});

describe("perishable SKU (3-4 week band)", () => {
  it("2.5 weeks is stockout", () => {
    expect(evaluateSku(sku({ perishable: true, on_hand: 250 }), rules).status).toBe("stockout");
  });
  it("3.5 weeks is on_track", () => {
    expect(evaluateSku(sku({ perishable: true, on_hand: 350 }), rules).status).toBe("on_track");
  });
  it("4.5 weeks is overstock", () => {
    const r = evaluateSku(sku({ perishable: true, on_hand: 450 }), rules);
    expect(r.status).toBe("overstock");
    expect(r.recommended_qty).toBe(0);
  });
});

describe("festival uplift", () => {
  // Flat 100/wk, stock 700: cover 7.0 normally, 5.6 with 1.25x uplift.
  for (const [name, month] of [["March", 3], ["October", 10], ["November", 11]] as const) {
    it(`${name} applies the uplift and changes the result`, () => {
      const r = evaluateSku(sku({ on_hand: 700, planning_month: month }), rules);
      expect(r.weekly_demand).toBeCloseTo(125);
      expect(r.status).toBe("stockout");
    });
  }
  it("a non-festival month does not apply the uplift", () => {
    const r = evaluateSku(sku({ on_hand: 700, planning_month: 5 }), rules);
    expect(r.weekly_demand).toBeCloseTo(100);
    expect(r.status).toBe("on_track");
  });
});

describe("zero sales", () => {
  it("does not divide by zero; stock with no sales is overstock", () => {
    const r = evaluateSku(sku({ weekly_sales: flat(0), on_hand: 100 }), rules);
    expect(Number.isNaN(r.cover_weeks)).toBe(false);
    expect(r.status).toBe("overstock");
    expect(r.recommended_qty).toBe(0);
  });
  it("no sales and no stock is on_track", () => {
    const r = evaluateSku(sku({ weekly_sales: flat(0), on_hand: 0 }), rules);
    expect(r.status).toBe("on_track");
  });
});

describe("review routing", () => {
  it("new SKU (under 12 weeks) goes to needs_review but keeps the rule result", () => {
    const r = evaluateSku(sku({ weekly_sales: flat(100, 6), weeks_history: 6, on_hand: 300 }), rules);
    expect(r.status).toBe("needs_review");
    expect(r.rule_status).toBe("stockout");
    expect(r.recommended_qty).toBe(500);
    expect(r.review_reasons[0]).toMatch(/New launch/);
  });
  it("erratic SKU (CV above 0.5) goes to needs_review", () => {
    const erratic = [10, 300, 20, 250, 15, 280, 30, 260, 10, 290, 20, 270];
    const r = evaluateSku(sku({ weekly_sales: erratic }), rules);
    expect(r.status).toBe("needs_review");
    expect(r.review_reasons.join(" ")).toMatch(/Erratic/);
  });
  it("sudden last-week drop goes to needs_review", () => {
    const r = evaluateSku(sku({ weekly_sales: [...flat(100, 11), 50] }), rules);
    expect(r.status).toBe("needs_review");
    expect(r.review_reasons.join(" ")).toMatch(/Sudden drop/);
  });
  it("a drop to exactly 65% is not flagged", () => {
    const r = evaluateSku(sku({ weekly_sales: [...flat(100, 11), 65] }), rules);
    expect(r.review_reasons.join(" ")).not.toMatch(/Sudden drop/);
  });
  it("a stable 12-week SKU is not routed to review", () => {
    expect(evaluateSku(sku(), rules).review_reasons).toEqual([]);
  });
});

describe("open POs", () => {
  const s = { on_hand: 400, open_po_qty: 300 }; // 4 vs 7 weeks of cover
  it("counted when include_open_pos_in_stock is true", () => {
    const r = evaluateSku(sku(s), { ...rules, include_open_pos_in_stock: true });
    expect(r.effective_stock).toBe(700);
    expect(r.status).toBe("on_track");
  });
  it("ignored when false", () => {
    const r = evaluateSku(sku(s), { ...rules, include_open_pos_in_stock: false });
    expect(r.effective_stock).toBe(400);
    expect(r.status).toBe("stockout");
  });
});
