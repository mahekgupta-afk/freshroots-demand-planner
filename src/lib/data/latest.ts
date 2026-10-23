import type { Query } from "@/lib/db/server";
import type { RecStatus } from "@/lib/rules/engine";
import { URGENCY } from "@/lib/pipeline/run";
import { rules } from "@/lib/data/sample";

export interface RunInfo {
  id: string;
  started_at: string;
  rules_version: string;
  planning_month: number;
  trigger: string;
  stock_as_of: string | null;
}

export interface RecRow {
  id: string;
  sku_id: string;
  name: string;
  perishable: boolean;
  status: RecStatus;
  rule_status: RecStatus;
  effective_stock: number;
  weekly_demand: number;
  /** null means infinite (no recent sales). */
  cover_weeks: number | null;
  recommended_qty: number | null;
  reasons: string[];
  review_reasons: string[];
  review_state: "auto" | "pending" | "approved" | "overridden";
  final_qty: number | null;
  override_reason: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  gemini_note: string | null;
  gemini_confidence: string | null;
  weekly_sales: number[];
}

export interface Summary {
  total: number;
  counts: Record<RecStatus, number>;
  pending_review: number;
  rules_share: number;
  festival_month: boolean;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function summarize(recs: RecRow[], planningMonth: number): Summary {
  const counts = Object.fromEntries(URGENCY.map((s) => [s, 0])) as Record<RecStatus, number>;
  for (const r of recs) counts[r.status]++;
  return {
    total: recs.length,
    counts,
    pending_review: recs.filter((r) => r.review_state === "pending").length,
    rules_share: recs.length ? (recs.length - counts.needs_review) / recs.length : 0,
    festival_month: rules.festival_months.includes(planningMonth),
  };
}

/** Latest finished run with its recommendations, most urgent first. Null if no run has finished. */
export async function getLatestRun(query: Query): Promise<{ run: RunInfo; recs: RecRow[]; summary: Summary } | null> {
  const [r] = await query(
    `select id, started_at::text as started_at, rules_version, planning_month, trigger,
            summary->>'stock_as_of' as stock_as_of
       from runs where status = 'done' order by started_at desc limit 1`,
  );
  if (!r) return null;

  const rows = await query(
    `select rec.id, rec.sku_id, s.name, s.perishable, rec.status::text as status, rec.rule_status::text as rule_status,
            rec.effective_stock::float8 as effective_stock, rec.weekly_demand::float8 as weekly_demand,
            rec.cover_weeks::float8 as cover_weeks, rec.recommended_qty, rec.reasons, rec.review_reasons,
            rec.review_state::text as review_state, rec.final_qty, rec.override_reason,
            p.full_name as decided_by_name, rec.decided_at::text as decided_at,
            rec.gemini_note, rec.gemini_confidence,
            coalesce((select json_agg(w.qty order by w.week_start)
                        from (select qty::float8 as qty, week_start from weekly_sales
                               where sku_id = rec.sku_id order by week_start desc limit 12) w), '[]'::json) as weekly_sales
       from recommendations rec
       join skus s on s.sku_id = rec.sku_id
       left join profiles p on p.id = rec.decided_by
      where rec.run_id = $1
      order by array_position(array['stockout','needs_review','high_demand','overstock','on_track'], rec.status::text),
               rec.cover_weeks nulls last, rec.sku_id`,
    [r.id],
  );

  const recs: RecRow[] = rows.map((x) => ({
    id: String(x.id),
    sku_id: String(x.sku_id),
    name: String(x.name),
    perishable: Boolean(x.perishable),
    status: x.status as RecStatus,
    rule_status: x.rule_status as RecStatus,
    effective_stock: Number(x.effective_stock),
    weekly_demand: Number(x.weekly_demand),
    cover_weeks: num(x.cover_weeks),
    recommended_qty: num(x.recommended_qty),
    reasons: arr(x.reasons),
    review_reasons: arr(x.review_reasons),
    review_state: x.review_state as RecRow["review_state"],
    final_qty: num(x.final_qty),
    override_reason: x.override_reason === null ? null : String(x.override_reason),
    decided_by_name: x.decided_by_name === null ? null : String(x.decided_by_name),
    decided_at: x.decided_at === null ? null : String(x.decided_at),
    gemini_note: x.gemini_note === null ? null : String(x.gemini_note),
    gemini_confidence: x.gemini_confidence === null ? null : String(x.gemini_confidence),
    // Arrays of numbers may arrive as JSON text or parsed, depending on the driver.
    weekly_sales: (typeof x.weekly_sales === "string" ? JSON.parse(x.weekly_sales) : (x.weekly_sales as number[])).map(Number),
  }));

  const run: RunInfo = {
    id: String(r.id),
    started_at: String(r.started_at),
    rules_version: String(r.rules_version),
    planning_month: Number(r.planning_month),
    trigger: String(r.trigger),
    stock_as_of: r.stock_as_of === null ? null : String(r.stock_as_of),
  };
  return { run, recs, summary: summarize(recs, run.planning_month) };
}
