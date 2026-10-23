import { neonQuery, type Query } from "@/lib/db/server";
import { rules } from "@/lib/data/sample";
import { runPipeline, planningMonthIST, type PipelineInput } from "./run";

/**
 * Full scheduled run against Postgres: read inputs, apply rules, save run + recommendations.
 * Zoho sync, Gemini triage and email are added in later phases.
 * `query` is injectable so tests can run against an in-memory Postgres.
 */
export async function executeRun(trigger: "cron" | "manual", query: Query = neonQuery()) {
  const planningMonth = planningMonthIST();

  const [run] = await query(
    "insert into runs (planning_month, rules_version, trigger) values ($1, $2, $3) returning id",
    [planningMonth, rules.version, trigger],
  );
  const runId = String(run!.id);

  try {
    const skus = (await query(
      "select sku_id, name, perishable, std_qty from skus where active order by sku_id",
    )) as unknown as PipelineInput["skus"];
    if (skus.length === 0) throw new Error("No active SKUs in the database. Load the SAP export first.");

    const sales = (await query(
      "select sku_id, week_start::text as week_start, qty::float8 as qty from weekly_sales order by week_start",
    )) as unknown as PipelineInput["sales"];
    const stock = (await query(
      "select sku_id, snapshot_date::text as snapshot_date, on_hand::float8 as on_hand from stock_snapshots",
    )) as unknown as PipelineInput["stock"];
    const openPos = (await query(
      "select sku_id, qty::float8 as qty from open_pos",
    )) as unknown as PipelineInput["openPos"];

    const { planned, summary } = runPipeline({ rules, planningMonth, skus, sales, stock, openPos });

    const rows = planned.map((p) => ({
      run_id: runId,
      sku_id: p.sku_id,
      status: p.status,
      rule_status: p.rule_status,
      avg_12wk: p.avg_12wk,
      last_4wk_avg: p.last_4wk_avg,
      weekly_demand: p.weekly_demand,
      effective_stock: p.effective_stock,
      // Postgres numeric cannot hold Infinity (zero-demand SKUs).
      cover_weeks: Number.isFinite(p.cover_weeks) ? p.cover_weeks : null,
      recommended_qty: p.recommended_qty,
      reasons: p.reasons,
      review_reasons: p.review_reasons,
      review_state: p.review_state,
    }));
    // Explicit column list: populate_recordset yields NULL for absent columns, which would skip defaults (id, created_at).
    const cols = Object.keys(rows[0] ?? {}).join(", ");
    await query(
      `insert into recommendations (${cols}) select ${cols} from jsonb_populate_recordset(null::recommendations, $1::jsonb)`,
      [JSON.stringify(rows)],
    );

    await query("update runs set status = 'done', finished_at = now(), summary = $2::jsonb where id = $1", [
      runId,
      JSON.stringify(summary),
    ]);
    return { runId, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await query("update runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, message]);
    throw e;
  }
}
