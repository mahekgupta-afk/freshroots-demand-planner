import { serviceClient, fetchAll } from "@/lib/supabase/server";
import { rules } from "@/lib/data/sample";
import { runPipeline, planningMonthIST, type PipelineInput } from "./run";

/**
 * Full scheduled run against Supabase: read inputs, apply rules, save run + recommendations.
 * Zoho sync, Gemini triage and email are added in later phases.
 */
export async function executeRun(trigger: "cron" | "manual") {
  const db = serviceClient();
  const planningMonth = planningMonthIST();

  const { data: run, error: runErr } = await db
    .from("runs")
    .insert({ planning_month: planningMonth, rules_version: rules.version, trigger })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`Could not start run: ${runErr?.message}`);

  try {
    const [skus, sales, stock, openPos] = await Promise.all([
      fetchAll<PipelineInput["skus"][number] & { active: boolean }>((f, t) =>
        db.from("skus").select("sku_id,name,perishable,std_qty,active").eq("active", true).range(f, t)),
      fetchAll<PipelineInput["sales"][number]>((f, t) =>
        db.from("weekly_sales").select("sku_id,week_start,qty").order("week_start").range(f, t)),
      fetchAll<PipelineInput["stock"][number]>((f, t) =>
        db.from("stock_snapshots").select("sku_id,snapshot_date,on_hand").range(f, t)),
      fetchAll<PipelineInput["openPos"][number]>((f, t) =>
        db.from("open_pos").select("sku_id,qty").range(f, t)),
    ]);
    if (skus.length === 0) throw new Error("No active SKUs in Supabase. Load the SAP export first.");

    const { planned, summary } = runPipeline({ rules, planningMonth, skus, sales, stock, openPos });

    const rows = planned.map((p) => ({
      run_id: run.id,
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
    const { error: insErr } = await db.from("recommendations").insert(rows);
    if (insErr) throw new Error(`Saving recommendations failed: ${insErr.message}`);

    await db.from("runs").update({ status: "done", finished_at: new Date().toISOString(), summary }).eq("id", run.id);
    return { runId: run.id, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", run.id);
    throw e;
  }
}
