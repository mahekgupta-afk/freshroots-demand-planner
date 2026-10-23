import { neonQuery } from "@/lib/db/server";
import { requireUser } from "@/lib/auth/session";
import { getLatestRun } from "@/lib/data/latest";
import { StatusBadge, STATUS_LABEL } from "@/components/status";
import { Sparkline } from "@/components/sparkline";
import { formatWhen, qtyLabel } from "@/lib/format";
import { DecisionForms } from "./decision-forms";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await requireUser();
  const latest = await getLatestRun(neonQuery());
  const canDecide = user.role === "planner" || user.role === "admin";

  if (!latest) return <p className="text-slate-600">No run yet. Start one from the dashboard.</p>;

  const pending = latest.recs.filter((r) => r.review_state === "pending");
  const decided = latest.recs.filter((r) => r.review_state === "approved" || r.review_state === "overridden");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          SKUs the rules cannot safely decide on their own. The rule result is shown for reference.
          {!canDecide && " You have read-only access; planners and admins make the decisions."}
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">Nothing waiting for review. 🎉</div>
      ) : (
        <ul className="space-y-4">
          {pending.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-medium">{r.sku_id} <span className="font-normal text-slate-600">· {r.name}{r.perishable ? " · perishable" : ""}</span></div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <StatusBadge status="needs_review" />
                    <span>Rules say: <strong>{STATUS_LABEL[r.rule_status]}</strong>, suggested order <strong>{qtyLabel(r.recommended_qty)}</strong></span>
                  </div>
                </div>
                <Sparkline values={r.weekly_sales} width={140} height={36} />
              </div>

              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {r.review_reasons.map((x) => <li key={x}>{x}</li>)}
              </ul>
              <p className="mt-2 text-sm text-slate-600">
                Stock {Math.round(r.effective_stock)} · demand {r.weekly_demand.toFixed(0)}/wk · cover {r.cover_weeks === null ? "∞" : r.cover_weeks.toFixed(1)} weeks
              </p>
              {r.gemini_note && (
                <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                  <span className="font-medium">AI note{r.gemini_confidence ? ` (${r.gemini_confidence} confidence)` : ""}:</span> {r.gemini_note}
                </p>
              )}
              {canDecide && <DecisionForms id={r.id} suggested={r.recommended_qty} />}
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Decided in this run</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Decision</th><th className="px-3 py-2 text-right">Final qty</th><th className="px-3 py-2">By</th><th className="px-3 py-2">Reason</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><div className="font-medium">{r.sku_id}</div><div className="text-xs text-slate-500">{r.name}</div></td>
                    <td className="px-3 py-2">{r.review_state === "approved" ? "Approved" : "Overridden"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qtyLabel(r.final_qty)}</td>
                    <td className="px-3 py-2">{r.decided_by_name ?? "–"}<div className="text-xs text-slate-500">{r.decided_at ? formatWhen(r.decided_at) : ""}</div></td>
                    <td className="px-3 py-2 text-slate-600">{r.override_reason ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
