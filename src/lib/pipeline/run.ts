import { evaluateSku, type RecStatus, type Recommendation } from "@/lib/rules/engine";
import type { Rules } from "@/lib/rules/schema";

export interface PipelineInput {
  rules: Rules;
  planningMonth: number;
  skus: { sku_id: string; name: string; perishable: boolean; std_qty: number }[];
  sales: { sku_id: string; week_start: string; qty: number }[];
  stock: { sku_id: string; snapshot_date: string; on_hand: number }[];
  openPos: { sku_id: string; qty: number }[];
}

export interface PlannedSku extends Recommendation {
  name: string;
  perishable: boolean;
  std_qty: number;
  /** Last 12 weeks, oldest first. For charts. */
  weekly_sales: number[];
  on_hand: number;
  open_po_qty: number;
  review_state: "auto" | "pending";
}

export interface RunSummary {
  total: number;
  counts: Record<RecStatus, number>;
  /** Share of SKUs decided by rules alone (not sent to review). */
  rules_share: number;
  festival_month: boolean;
  stock_as_of: string | null;
}

/** Most urgent first. */
export const URGENCY: RecStatus[] = ["stockout", "needs_review", "high_demand", "overstock", "on_track"];

/** Pure: no I/O. Runs the rules engine across every active SKU. */
export function runPipeline(input: PipelineInput): { planned: PlannedSku[]; summary: RunSummary } {
  const { rules, planningMonth } = input;

  const salesBySku = new Map<string, { week_start: string; qty: number }[]>();
  for (const s of input.sales) {
    const list = salesBySku.get(s.sku_id) ?? [];
    list.push(s);
    salesBySku.set(s.sku_id, list);
  }
  const latestStock = new Map<string, { snapshot_date: string; on_hand: number }>();
  for (const s of input.stock) {
    const cur = latestStock.get(s.sku_id);
    if (!cur || s.snapshot_date > cur.snapshot_date) latestStock.set(s.sku_id, s);
  }
  const poBySku = new Map<string, number>();
  for (const p of input.openPos) poBySku.set(p.sku_id, (poBySku.get(p.sku_id) ?? 0) + p.qty);

  const planned: PlannedSku[] = input.skus.map((sku) => {
    const weeks = (salesBySku.get(sku.sku_id) ?? [])
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .map((w) => w.qty);
    const onHand = latestStock.get(sku.sku_id)?.on_hand ?? 0;
    const openPo = poBySku.get(sku.sku_id) ?? 0;
    const rec = evaluateSku(
      {
        sku_id: sku.sku_id,
        perishable: sku.perishable,
        std_qty: sku.std_qty,
        weekly_sales: weeks,
        weeks_history: weeks.length,
        on_hand: onHand,
        open_po_qty: openPo,
        planning_month: planningMonth,
      },
      rules,
    );
    return {
      ...rec,
      name: sku.name,
      perishable: sku.perishable,
      std_qty: sku.std_qty,
      weekly_sales: weeks.slice(-12),
      on_hand: onHand,
      open_po_qty: openPo,
      review_state: rec.status === "needs_review" ? "pending" : "auto",
    };
  });

  planned.sort(
    (a, b) => URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status) || a.cover_weeks - b.cover_weeks,
  );

  const counts: Record<RecStatus, number> = { stockout: 0, needs_review: 0, high_demand: 0, overstock: 0, on_track: 0 };
  for (const p of planned) counts[p.status]++;
  const stockDates = [...latestStock.values()].map((s) => s.snapshot_date).sort();

  return {
    planned,
    summary: {
      total: planned.length,
      counts,
      rules_share: planned.length ? (planned.length - counts.needs_review) / planned.length : 0,
      festival_month: rules.festival_months.includes(planningMonth),
      stock_as_of: stockDates.at(-1) ?? null,
    },
  };
}

/** Calendar month (1-12) in India, so a 7am IST cron never lands on the wrong month. */
export function planningMonthIST(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "numeric" }).format(now));
}
