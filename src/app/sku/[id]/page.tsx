import Link from "next/link";
import { notFound } from "next/navigation";
import { neonQuery } from "@/lib/db/server";
import { requireUser } from "@/lib/auth/session";
import { getSkuDetail } from "@/lib/data/history";
import { StatusBadge, STATUS_LABEL } from "@/components/status";
import { Sparkline } from "@/components/sparkline";
import { formatWhen, qtyLabel } from "@/lib/format";
import type { RecStatus } from "@/lib/rules/engine";

export const dynamic = "force-dynamic";
const fmt = new Intl.NumberFormat("en-IN");
const one = (n: number | null) => (n === null ? "–" : n.toFixed(1));

export default async function SkuPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const detail = await getSkuDetail(neonQuery(), decodeURIComponent(id));
  if (!detail) notFound();
  const { sku, weeks, history } = detail;
  const latest = history[0];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/recommendations" className="text-sm text-slate-500 hover:underline">← Recommendations</Link>
        <h1 className="mt-1 text-2xl font-semibold">{sku.sku_id} <span className="font-normal text-slate-600">· {sku.name}</span></h1>
        <p className="mt-1 text-sm text-slate-600">
          {sku.perishable ? "Perishable (3–4 weeks of cover)" : "Standard (6–14 weeks of cover)"} · standard reorder {fmt.format(sku.std_qty)}
          {!sku.active && " · inactive"}
        </p>
      </div>

      {latest ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Latest result</h2>
              <p className="mt-1 text-sm text-slate-600">Run on {formatWhen(latest.run_at)}</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={latest.status as RecStatus} />
                {latest.status === "needs_review" && <span className="text-sm text-slate-600">rules said {STATUS_LABEL[latest.rule_status as RecStatus]}</span>}
              </div>
            </div>
            <Sparkline values={weeks.slice(-12).map((w) => w.qty)} width={200} height={48} />
          </div>

          <h3 className="mt-5 text-sm font-semibold text-slate-700">How the rules got there</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            <Row k="12-week average" v={one(latest.avg_12wk)} />
            <Row k="Last 4 weeks average" v={one(latest.last_4wk_avg)} />
            <Row k="Demand used (after any festival uplift)" v={one(latest.weekly_demand)} />
            <Row k="Stock incl. open orders" v={latest.effective_stock === null ? "–" : fmt.format(Math.round(latest.effective_stock))} />
            <Row k="Weeks of cover" v={latest.cover_weeks === null ? "∞" : one(latest.cover_weeks)} />
            <Row k="Rule quantity" v={qtyLabel(latest.recommended_qty)} />
          </dl>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {latest.reasons.map((r) => <li key={r}>{r}</li>)}
            {latest.review_reasons.map((r) => <li key={r} className="text-amber-900">Flagged for review: {r}</li>)}
          </ul>
          {latest.gemini_note && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700"><span className="font-medium">AI note:</span> {latest.gemini_note}</p>}
        </section>
      ) : (
        <p className="text-slate-600">No finished run includes this SKU yet.</p>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Weekly sales</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>{weeks.map((w) => <th key={w.week_start} className="px-2 py-2 text-right font-medium">{w.week_start.slice(5)}</th>)}</tr>
            </thead>
            <tbody><tr>{weeks.map((w) => <td key={w.week_start} className="px-2 py-2 text-right tabular-nums">{fmt.format(w.qty)}</td>)}</tr></tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-500">Week starting (month-day), most recent on the right.</p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">History</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Run</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Cover</th><th className="px-3 py-2 text-right">Rule qty</th><th className="px-3 py-2 text-right">Final qty</th><th className="px-3 py-2">Decision</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id} className="align-top">
                  <td className="px-3 py-2">{formatWhen(h.run_at)}</td>
                  <td className="px-3 py-2"><StatusBadge status={h.status as RecStatus} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.cover_weeks === null ? "∞" : one(h.cover_weeks)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qtyLabel(h.recommended_qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.final_qty === null ? "–" : qtyLabel(h.final_qty)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {h.review_state === "auto" ? "Rules" : h.review_state === "pending" ? "Waiting for review" : `${h.review_state === "approved" ? "Approved" : "Overridden"} by ${h.decided_by_name ?? "?"}`}
                    {h.override_reason && <div className="text-xs text-slate-500">{h.override_reason}</div>}
                  </td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>;
}
