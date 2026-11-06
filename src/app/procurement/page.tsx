import Link from "next/link";
import { neonQuery } from "@/lib/db/server";
import { requireUser } from "@/lib/auth/session";
import { getLatestRun } from "@/lib/data/latest";
import { buildProcurementList } from "@/lib/data/procurement";
import { formatWhen } from "@/lib/format";
import { StaleBanner } from "@/components/stale-banner";

export const dynamic = "force-dynamic";
const fmt = new Intl.NumberFormat("en-IN");

export default async function ProcurementPage() {
  await requireUser();
  const latest = await getLatestRun(neonQuery());
  if (!latest) return <p className="text-slate-600">No run yet.</p>;
  const { items, waitingForReview } = buildProcurementList(latest.recs);
  const orders = items.filter((i) => i.action === "order");
  const pauses = items.filter((i) => i.action === "pause");

  return (
    <div className="space-y-6">
      <StaleBanner stockAsOf={latest.run.stock_as_of} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Procurement list</h1>
          <p className="mt-1 text-sm text-slate-600">
            From the run on {formatWhen(latest.run.started_at)} · stock as of {latest.run.stock_as_of ?? "n/a"} ·{" "}
            {orders.length} to order, {pauses.length} to pause
          </p>
        </div>
        <a href="/api/procurement" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">Download CSV</a>
      </div>

      {waitingForReview > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {waitingForReview} SKU{waitingForReview === 1 ? " is" : "s are"} not on this list yet because {waitingForReview === 1 ? "it is" : "they are"} waiting for a planner&apos;s review.{" "}
          <Link href="/review" className="underline">Open the review queue</Link>
        </p>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Order</h2>
        <ListTable rows={orders} empty="Nothing to order." qtyHeader="Order qty" />
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Pause (do not reorder)</h2>
        <ListTable rows={pauses} empty="Nothing to pause." qtyHeader="" />
      </section>
    </div>
  );
}

function ListTable({ rows, empty, qtyHeader }: { rows: ReturnType<typeof buildProcurementList>["items"]; empty: string; qtyHeader: string }) {
  if (rows.length === 0) return <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">SKU</th>
            {qtyHeader && <th className="px-3 py-2 text-right">{qtyHeader}</th>}
            <th className="px-3 py-2">Basis</th>
            <th className="px-3 py-2">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-2">
                <Link href={`/sku/${encodeURIComponent(r.sku_id)}`} className="font-medium hover:underline">{r.sku_id}</Link>
                <div className="text-xs text-slate-500">{r.name}</div>
              </td>
              {qtyHeader && <td className="px-3 py-2 text-right tabular-nums">{fmt.format(r.qty)}</td>}
              <td className="px-3 py-2">
                {r.source === "rules" ? "Rules" : r.source === "approved" ? "Approved" : "Overridden"}
                {r.decided_by && <div className="text-xs text-slate-500">{r.decided_by}</div>}
              </td>
              <td className="px-3 py-2 text-slate-600">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
