import type { Query } from "@/lib/db/server";

export interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  status: string;
  rules_version: string;
  error: string | null;
  counts: Record<string, number> | null;
  ai: { attempted: number; succeeded: number; failed: number; skipped_reason: string | null } | null;
  notify: { sent: boolean; recipients: number; skipped?: string; error?: string } | null;
  stock_as_of: string | null;
}

const asObj = <T>(v: unknown): T | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
};

export async function getRuns(query: Query, limit = 30): Promise<RunRow[]> {
  const rows = await query(
    `select id, started_at::text as started_at, finished_at::text as finished_at, trigger, status, rules_version, error, summary
       from runs order by started_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => {
    const s = asObj<{ counts?: Record<string, number>; ai?: RunRow["ai"]; notify?: RunRow["notify"]; stock_as_of?: string }>(r.summary);
    return {
      id: String(r.id),
      started_at: String(r.started_at),
      finished_at: r.finished_at === null ? null : String(r.finished_at),
      trigger: String(r.trigger),
      status: String(r.status),
      rules_version: String(r.rules_version),
      error: r.error === null ? null : String(r.error),
      counts: s?.counts ?? null,
      ai: s?.ai ?? null,
      notify: s?.notify ?? null,
      stock_as_of: s?.stock_as_of ?? null,
    };
  });
}

export interface SkuHistoryRow {
  id: string;
  run_at: string;
  status: string;
  rule_status: string;
  avg_12wk: number | null;
  last_4wk_avg: number | null;
  weekly_demand: number | null;
  effective_stock: number | null;
  cover_weeks: number | null;
  recommended_qty: number | null;
  reasons: string[];
  review_reasons: string[];
  review_state: string;
  final_qty: number | null;
  override_reason: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  gemini_note: string | null;
}

export interface SkuDetail {
  sku: { sku_id: string; name: string; perishable: boolean; std_qty: number; active: boolean };
  weeks: { week_start: string; qty: number }[];
  history: SkuHistoryRow[];
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** One SKU's master data, recent weekly sales, and its recommendation history (newest first, finished runs only). */
export async function getSkuDetail(query: Query, skuId: string, runs = 20): Promise<SkuDetail | null> {
  const [sku] = await query("select sku_id, name, perishable, std_qty, active from skus where sku_id = $1", [skuId]);
  if (!sku) return null;
  const weeks = await query(
    "select week_start::text as week_start, qty::float8 as qty from weekly_sales where sku_id = $1 order by week_start desc limit 16",
    [skuId],
  );
  const hist = await query(
    `select rec.id, r.started_at::text as run_at, rec.status::text as status, rec.rule_status::text as rule_status,
            rec.avg_12wk::float8 as avg_12wk, rec.last_4wk_avg::float8 as last_4wk_avg, rec.weekly_demand::float8 as weekly_demand,
            rec.effective_stock::float8 as effective_stock, rec.cover_weeks::float8 as cover_weeks, rec.recommended_qty,
            rec.reasons, rec.review_reasons, rec.review_state::text as review_state, rec.final_qty, rec.override_reason,
            p.full_name as decided_by_name, rec.decided_at::text as decided_at, rec.gemini_note
       from recommendations rec
       join runs r on r.id = rec.run_id and r.status = 'done'
       left join profiles p on p.id = rec.decided_by
      where rec.sku_id = $1
      order by r.started_at desc limit $2`,
    [skuId, runs],
  );
  return {
    sku: { sku_id: String(sku.sku_id), name: String(sku.name), perishable: Boolean(sku.perishable), std_qty: Number(sku.std_qty), active: Boolean(sku.active) },
    weeks: weeks.map((w) => ({ week_start: String(w.week_start), qty: Number(w.qty) })).reverse(),
    history: hist.map((h) => ({
      id: String(h.id), run_at: String(h.run_at), status: String(h.status), rule_status: String(h.rule_status),
      avg_12wk: n(h.avg_12wk), last_4wk_avg: n(h.last_4wk_avg), weekly_demand: n(h.weekly_demand),
      effective_stock: n(h.effective_stock), cover_weeks: n(h.cover_weeks), recommended_qty: n(h.recommended_qty),
      reasons: arr(h.reasons), review_reasons: arr(h.review_reasons), review_state: String(h.review_state),
      final_qty: n(h.final_qty), override_reason: s(h.override_reason), decided_by_name: s(h.decided_by_name),
      decided_at: s(h.decided_at), gemini_note: s(h.gemini_note),
    })),
  };
}
