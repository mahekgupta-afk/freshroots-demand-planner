import { neonQuery, type Query } from "@/lib/db/server";
import { rules } from "@/lib/data/sample";
import { runPipeline, planningMonthIST, type PipelineInput } from "./run";
import { appUrlFromEnv, notifierFromEnv, type Notifier, type NotifyOutcome } from "@/lib/email/notify";
import { triageAll, type TriageConfig, type TriageItem, type TriageOutcome } from "@/lib/gemini/triage";

/** Leaves headroom inside a 60s serverless function for ingest, saving and the response. */
const AI_BUDGET_MS = 35_000;

export interface RunOptions {
  /** Override the triage step (tests). Defaults to the real Gemini call when the env vars are set. */
  triage?: (items: TriageItem[], onCall: TriageConfig["onCall"]) => Promise<TriageOutcome[]>;
  /** Override email sending (tests). `null` turns it off. Defaults to Resend when configured in the environment. */
  notify?: Notifier | null;
  /** Public site address for links in emails. Defaults to APP_URL or the Vercel production URL. */
  appUrl?: string | null;
}

/**
 * Full scheduled run against Postgres: read inputs, apply rules, save run + recommendations.
 * Zoho sync, Gemini triage and email are added in later phases.
 * `query` is injectable so tests can run against an in-memory Postgres.
 */
export async function executeRun(trigger: "cron" | "manual", query: Query = neonQuery(), opts: RunOptions = {}) {
  const planningMonth = planningMonthIST();

  const [run] = await query(
    "insert into runs (planning_month, rules_version, trigger) values ($1, $2, $3) returning id, started_at::text as started_at",
    [planningMonth, rules.version, trigger],
  );
  const runId = String(run!.id);
  const startedAt = String(run!.started_at);

  const configured = opts.notify === undefined ? notifierFromEnv() : { notifier: opts.notify, reason: opts.notify ? null : "email disabled" };
  const appUrl = opts.appUrl === undefined ? appUrlFromEnv() : opts.appUrl;
  const record = (o: NotifyOutcome) =>
    query("update runs set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('notify', $2::jsonb) where id = $1", [runId, JSON.stringify(o)]);

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

    // AI notes for the SKUs the rules cannot decide. Strictly advisory: quantities come from the rules only,
    // and nothing in this block can fail the run.
    const ai = { attempted: 0, succeeded: 0, failed: 0, skipped_reason: null as string | null };
    const notes = new Map<string, TriageOutcome>();
    const toTriage: TriageItem[] = planned
      .filter((p) => p.status === "needs_review")
      .map((p) => ({
        sku_id: p.sku_id, name: p.name, perishable: p.perishable, weekly_sales: p.weekly_sales,
        on_hand: p.on_hand, open_po_qty: p.open_po_qty, rule_status: p.rule_status,
        rule_qty: p.recommended_qty, review_reasons: p.review_reasons, planning_month: planningMonth,
      }));
    if (toTriage.length > 0) {
      const apiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MODEL;
      const triage = opts.triage ?? (apiKey && model
        ? (items: TriageItem[], onCall: TriageConfig["onCall"]) => triageAll(items, { apiKey, model, onCall, deadlineAt: Date.now() + AI_BUDGET_MS })
        : null);
      if (!triage) {
        ai.skipped_reason = "GEMINI_API_KEY or GEMINI_MODEL is not set";
      } else {
        try {
          const outcomes = await triage(toTriage, async (log) => {
            await query(
              "insert into ai_calls (run_id, sku_id, model, request, response, latency_ms, error) values ($1, null, $2, $3::jsonb, $4::jsonb, $5, $6)",
              [runId, log.model, JSON.stringify({ skus: log.skus, body: log.request }), JSON.stringify(log.response), log.latency_ms, log.error],
            );
          });
          for (const o of outcomes) notes.set(o.sku_id, o);
          ai.attempted = outcomes.length;
          ai.succeeded = outcomes.filter((o) => !o.failed).length;
          ai.failed = ai.attempted - ai.succeeded;
        } catch (e) {
          // Defensive: triageAll does not throw, but a custom triage might.
          ai.attempted = toTriage.length;
          ai.failed = toTriage.length;
          ai.skipped_reason = e instanceof Error ? e.message : String(e);
          for (const t of toTriage) notes.set(t.sku_id, { sku_id: t.sku_id, note: null, action: null, confidence: null, failed: true });
        }
      }
    }

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
      gemini_note: notes.get(p.sku_id)?.note ?? null,
      gemini_action: notes.get(p.sku_id)?.action ?? null,
      gemini_confidence: notes.get(p.sku_id)?.confidence ?? null,
      gemini_failed: notes.get(p.sku_id)?.failed ?? false,
    }));
    // Explicit column list: populate_recordset yields NULL for absent columns, which would skip defaults (id, created_at).
    const cols = Object.keys(rows[0] ?? {}).join(", ");
    await query(
      `insert into recommendations (${cols}) select ${cols} from jsonb_populate_recordset(null::recommendations, $1::jsonb)`,
      [JSON.stringify(rows)],
    );

    await query("update runs set status = 'done', finished_at = now(), summary = $2::jsonb where id = $1", [
      runId,
      JSON.stringify({ ...summary, ai }),
    ]);

    // Email is best-effort and runs after the run is already marked done: nothing here can fail the run.
    let notify: NotifyOutcome;
    try {
      if (trigger !== "cron") notify = { sent: false, recipients: 0, skipped: "manual run" };
      else if (!configured.notifier) notify = { sent: false, recipients: 0, skipped: configured.reason ?? "email not configured" };
      else {
        notify = await configured.notifier.run({
          startedAt,
          rulesVersion: rules.version,
          planningMonth,
          total: summary.total,
          counts: summary.counts,
          pendingReview: planned.filter((p) => p.review_state === "pending").length,
          rulesShare: summary.rules_share,
          festival: summary.festival_month,
          urgent: planned.filter((p) => p.status !== "on_track").slice(0, 5)
            .map((p) => ({ sku_id: p.sku_id, name: p.name, status: p.status, qty: p.recommended_qty })),
          aiFailed: ai.failed,
          appUrl,
        });
      }
      await record(notify);
    } catch (e) {
      notify = { sent: false, recipients: 0, error: e instanceof Error ? e.message : String(e) };
    }
    return { runId, summary: { ...summary, ai, notify } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await query("update runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, message]);
    // Failures must be loud: alert whoever is on the alert list. Best-effort, and never masks the real error.
    try {
      const outcome: NotifyOutcome = configured.notifier
        ? await configured.notifier.failure({ startedAt, error: message, trigger, appUrl })
        : { sent: false, recipients: 0, skipped: configured.reason ?? "email not configured" };
      await record(outcome);
    } catch { /* ignore */ }
    throw e;
  }
}
