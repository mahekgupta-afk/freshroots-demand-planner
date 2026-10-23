import Link from "next/link";
import { loadSampleRun } from "@/lib/data/sample";
import { URGENCY } from "@/lib/pipeline/run";
import type { RecStatus } from "@/lib/rules/engine";
import { StatusBadge, STATUS_LABEL } from "@/components/status";
import { Sparkline } from "@/components/sparkline";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("en-IN");

export default async function Recommendations({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUser();
  const { status } = await searchParams;
  const filter = URGENCY.find((s) => s === status) as RecStatus | undefined;
  const { planned, summary } = loadSampleRun();
  const rows = filter ? planned.filter((p) => p.status === filter) : planned;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Recommendations</h1>
        <a href="/api/export" className="text-sm text-slate-600 underline hover:text-slate-900">Export CSV</a>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/recommendations" className={`rounded-full border px-3 py-1 ${!filter ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
          All ({summary.total})
        </Link>
        {URGENCY.map((s) => (
          <Link
            key={s}
            href={`/recommendations?status=${s}`}
            className={`rounded-full border px-3 py-1 ${filter === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}
          >
            {STATUS_LABEL[s]} ({summary.counts[s]})
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Demand / wk</th>
              <th className="px-3 py-2 text-right">Cover (wks)</th>
              <th className="px-3 py-2">12 weeks</th>
              <th className="px-3 py-2 text-right">Order qty</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.sku_id} className="align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.sku_id}</div>
                  <div className="text-xs text-slate-500">{p.name}{p.perishable ? " · perishable" : ""}</div>
                </td>
                <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.format(p.effective_stock)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.weekly_demand.toFixed(0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number.isFinite(p.cover_weeks) ? p.cover_weeks.toFixed(1) : "∞"}</td>
                <td className="px-3 py-2"><Sparkline values={p.weekly_sales} /></td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.recommended_qty === null ? "–" : p.recommended_qty === 0 ? "Pause" : fmt.format(p.recommended_qty)}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {p.status === "needs_review" ? p.review_reasons.join(" ") : p.reasons[0]}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No SKUs in this status.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
