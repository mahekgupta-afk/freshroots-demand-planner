import type { Rules } from "./schema";

export type RecStatus =
  | "stockout"
  | "overstock"
  | "high_demand"
  | "on_track"
  | "needs_review";

export interface SkuInput {
  sku_id: string;
  perishable: boolean;
  std_qty: number;
  /** Weekly sales, oldest first, most recent week last. Up to 12 values used. */
  weekly_sales: number[];
  /** Weeks of sales history available for this SKU (drives the new-launch trigger). */
  weeks_history: number;
  on_hand: number;
  open_po_qty: number;
  /** 1-12 */
  planning_month: number;
}

export interface Recommendation {
  sku_id: string;
  status: RecStatus;
  /** What the rules said, even if the SKU was routed to review. */
  rule_status: Exclude<RecStatus, "needs_review">;
  avg_12wk: number;
  last_4wk_avg: number;
  weekly_demand: number;
  effective_stock: number;
  cover_weeks: number;
  /** From rules only. 0 = pause. null = no action. */
  recommended_qty: number | null;
  reasons: string[];
  review_reasons: string[];
}

const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population coefficient of variation. 0 when the mean is 0. */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance) / m;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pure rules engine. No I/O.
 *
 * Boundaries: cover exactly equal to min or max is on_track
 * (stockout is strictly below min, overstock strictly above max).
 */
export function evaluateSku(sku: SkuInput, rules: Rules): Recommendation {
  const w = sku.weekly_sales.slice(-12);
  const avg12 = mean(w);
  const last4 = mean(w.slice(-4));
  const uplift = rules.festival_months.includes(sku.planning_month)
    ? rules.festival_uplift
    : 1;
  const weeklyDemand = avg12 * uplift;
  const effectiveStock =
    sku.on_hand + (rules.include_open_pos_in_stock ? sku.open_po_qty : 0);

  // Zero demand: any stock is infinite cover; no stock and no demand is nothing to act on.
  const noDemand = weeklyDemand === 0;
  const cover = noDemand ? Infinity : effectiveStock / weeklyDemand;
  const band = sku.perishable ? rules.cover_weeks.perishable : rules.cover_weeks.standard;

  // High demand compares raw sales, not uplifted.
  const highDemand =
    avg12 > 0 && last4 > avg12 * rules.high_demand.threshold_vs_12wk;
  const boosted = Math.round(rules.high_demand.reorder_multiplier * sku.std_qty);

  const reasons: string[] = [];
  let status: Exclude<RecStatus, "needs_review">;
  let qty: number | null;

  if (noDemand && effectiveStock === 0) {
    status = "on_track";
    qty = null;
    reasons.push("No sales and no stock. Nothing to act on.");
  } else if (cover < band.min) {
    status = "stockout";
    qty = highDemand ? boosted : sku.std_qty;
    reasons.push(
      `Cover ${round1(cover)} weeks is below the ${band.min}-week minimum.`,
    );
    if (highDemand) reasons.push("Recent demand is also high, so order 1.5x standard.");
  } else if (cover > band.max) {
    status = "overstock";
    qty = 0;
    reasons.push(
      noDemand
        ? "Stock on hand with no recent sales. Pause."
        : `Cover ${round1(cover)} weeks is above the ${band.max}-week maximum. Pause.`,
    );
  } else if (highDemand) {
    status = "high_demand";
    qty = boosted;
    reasons.push("Last 4 weeks are more than 20% above the 12-week average.");
  } else {
    status = "on_track";
    qty = null;
    reasons.push(`Cover ${round1(cover)} weeks is within ${band.min}-${band.max}.`);
  }

  if (uplift > 1) reasons.push(`Festival uplift of ${uplift}x applied to demand.`);

  const t = rules.review_triggers;
  const reviewReasons: string[] = [];
  if (sku.weeks_history < t.min_weeks_history) {
    reviewReasons.push(
      `New launch: only ${sku.weeks_history} weeks of history (need ${t.min_weeks_history}).`,
    );
  }
  if (coefficientOfVariation(w) > t.max_coefficient_of_variation) {
    reviewReasons.push("Erratic sales: coefficient of variation above threshold.");
  }
  if (w.length >= 4) {
    const prior3 = mean(w.slice(-4, -1));
    const latest = w[w.length - 1]!;
    if (prior3 > 0 && latest < t.last_week_drop_ratio * prior3) {
      reviewReasons.push("Sudden drop: last week is well below the prior 3-week average.");
    }
  }

  return {
    sku_id: sku.sku_id,
    status: reviewReasons.length > 0 ? "needs_review" : status,
    rule_status: status,
    avg_12wk: avg12,
    last_4wk_avg: last4,
    weekly_demand: weeklyDemand,
    effective_stock: effectiveStock,
    cover_weeks: cover,
    recommended_qty: qty,
    reasons,
    review_reasons: reviewReasons,
  };
}
