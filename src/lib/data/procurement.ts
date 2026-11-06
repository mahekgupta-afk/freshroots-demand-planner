import type { RecRow } from "./latest";

export interface ProcurementItem {
  id: string;
  sku_id: string;
  name: string;
  action: "order" | "pause";
  qty: number;
  source: "rules" | "approved" | "overridden";
  decided_by: string | null;
  reason: string;
}

/**
 * What procurement can act on now: SKUs whose quantity is settled, either by the rules alone or by a planner's decision.
 * SKUs still waiting for review are held back and only counted; on-track SKUs need no action and are omitted.
 */
export function buildProcurementList(recs: RecRow[]): { items: ProcurementItem[]; waitingForReview: number } {
  const items: ProcurementItem[] = [];
  let waiting = 0;
  for (const r of recs) {
    if (r.review_state === "pending") { waiting++; continue; }
    const decided = r.review_state === "approved" || r.review_state === "overridden";
    const qty = decided ? r.final_qty : r.recommended_qty;
    if (qty === null) continue;
    items.push({
      id: r.id,
      sku_id: r.sku_id,
      name: r.name,
      action: qty === 0 ? "pause" : "order",
      qty,
      source: r.review_state === "overridden" ? "overridden" : r.review_state === "approved" ? "approved" : "rules",
      decided_by: decided ? r.decided_by_name : null,
      reason: r.review_state === "overridden" && r.override_reason ? r.override_reason : (r.reasons[0] ?? ""),
    });
  }
  // Orders before pauses; within each, the order of `recs` (already most urgent first) is kept.
  items.sort((a, b) => (a.action === b.action ? 0 : a.action === "order" ? -1 : 1));
  return { items, waitingForReview: waiting };
}
