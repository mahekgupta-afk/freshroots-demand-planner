import Link from "next/link";
import { loadSampleRun } from "@/lib/data/sample";
import { URGENCY, planningMonthIST } from "@/lib/pipeline/run";
import { STATUS_LABEL } from "@/components/status";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });

export default async function Dashboard() {
  await requireUser();
  const { summary, rulesVersion } = loadSampleRun();
  const month = monthName(planningMonthIST());
  const attention = summary.counts.stockout + summary.counts.needs_review;

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        Sample data. This page is running on the SAP sample files, not live data.
      </div>

      {summary.festival_month && (
        <div className="rounded-md border border-orange-300 bg-orange-50 px-4 py-2 text-sm text-orange-900">
          Festival month ({month}): demand is uplifted 25% in the cover calculation.
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Rules version {rulesVersion} · stock as of {summary.stock_as_of ?? "n/a"} · {summary.total} SKUs
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {URGENCY.map((s) => (
          <Link
            key={s}
            href={`/recommendations?status=${s}`}
            className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <div className="text-3xl font-semibold tabular-nums">{summary.counts[s]}</div>
            <div className="mt-1 text-sm text-slate-600">{STATUS_LABEL[s]}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-600">Decided by rules alone</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{Math.round(summary.rules_share * 100)}%</div>
          <div className="mt-1 text-xs text-slate-500">Target is 80% or more. The rest go to Raghav.</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-600">Need action now</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{attention}</div>
          <div className="mt-1 text-xs text-slate-500">Stockouts plus SKUs waiting for review.</div>
        </div>
      </div>

      <div className="flex gap-3 text-sm">
        <Link href="/recommendations" className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700">
          View all recommendations
        </Link>
        <a href="/api/export" className="rounded-md border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50">
          Export CSV
        </a>
      </div>
    </div>
  );
}
