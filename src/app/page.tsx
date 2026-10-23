import Link from "next/link";
import { neonQuery } from "@/lib/db/server";
import { getLatestRun } from "@/lib/data/latest";
import { URGENCY } from "@/lib/pipeline/run";
import { STATUS_LABEL } from "@/components/status";
import { requireUser } from "@/lib/auth/session";
import { formatWhen, monthName } from "@/lib/format";
import { runNow } from "./review/actions";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser();
  const canRun = user.role === "planner" || user.role === "admin";
  const latest = await getLatestRun(neonQuery());

  const runButton = canRun && (
    <form action={runNow}>
      <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">Run now</button>
    </form>
  );

  if (!latest) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-slate-600">No run has finished yet. Runs happen Monday and Thursday at 7am IST.</p>
        {runButton}
      </div>
    );
  }
  const { run, summary } = latest;
  const attention = summary.counts.stockout + summary.pending_review;

  return (
    <div className="space-y-6">
      {summary.festival_month && (
        <div className="rounded-md border border-orange-300 bg-orange-50 px-4 py-2 text-sm text-orange-900">
          Festival month ({monthName(run.planning_month)}): demand is uplifted 25% in the cover calculation.
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Run {formatWhen(run.started_at)} ({run.trigger}) · rules {run.rules_version} · stock as of {run.stock_as_of ?? "n/a"} · {summary.total} SKUs
          </p>
        </div>
        {runButton}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {URGENCY.map((s) => (
          <Link key={s} href={s === "needs_review" ? "/review" : `/recommendations?status=${s}`}
            className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400">
            <div className="text-3xl font-semibold tabular-nums">{summary.counts[s]}</div>
            <div className="mt-1 text-sm text-slate-600">{STATUS_LABEL[s]}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-600">Decided by rules alone</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{Math.round(summary.rules_share * 100)}%</div>
          <div className="mt-1 text-xs text-slate-500">Target is 80% or more.</div>
        </div>
        <Link href="/review" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400">
          <div className="text-sm text-slate-600">Waiting for review</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{summary.pending_review}</div>
          <div className="mt-1 text-xs text-slate-500">Open the review queue.</div>
        </Link>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-600">Need action now</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{attention}</div>
          <div className="mt-1 text-xs text-slate-500">Stockouts plus SKUs waiting for review.</div>
        </div>
      </div>

      <div className="flex gap-3 text-sm">
        <Link href="/recommendations" className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700">View all recommendations</Link>
        <a href="/api/export" className="rounded-md border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50">Export CSV</a>
      </div>
    </div>
  );
}
