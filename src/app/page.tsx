import Link from "next/link";
import { neonQuery } from "@/lib/db/server";
import { getLatestRun, getRunProblem } from "@/lib/data/latest";
import { URGENCY } from "@/lib/pipeline/run";
import { STATUS_LABEL, STATUS_SOLID } from "@/components/status";
import { requireUser } from "@/lib/auth/session";
import { formatWhen, monthName } from "@/lib/format";
import { runNow } from "./review/actions";
import { StaleBanner } from "@/components/stale-banner";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the Run now server action runs the full pipeline

const card = "rounded-xl border border-slate-200 bg-white shadow-sm";
const TARGET = 0.8;

export default async function Dashboard() {
  const user = await requireUser();
  const canRun = user.role === "planner" || user.role === "admin";
  const query = neonQuery();
  const [latest, problem] = await Promise.all([getLatestRun(query), getRunProblem(query)]);

  const problemBanner = problem && (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      <strong>{problem.kind === "failed" ? "The latest run failed" : "The latest run did not finish"}</strong> ({formatWhen(problem.started_at)}).
      {problem.error && <span className="mt-1 block font-mono text-xs">{problem.error}</span>}
      <span className="mt-1 block">{latest ? "The numbers below are from the previous successful run." : "There are no successful runs yet."}</span>
    </div>
  );

  const runButton = canRun && (
    <form action={runNow}>
      <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
        Run now
      </button>
    </form>
  );

  if (!latest) {
    return (
      <div className="space-y-4">
        {problemBanner}
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-slate-600">No run has finished yet. Runs happen Monday and Thursday at 7am IST.</p>
        {runButton}
      </div>
    );
  }

  const { run, summary } = latest;
  const attention = summary.counts.stockout + summary.pending_review;
  const pct = Math.round(summary.rules_share * 100);
  const facts: [string, string][] = [
    ["Last run", `${formatWhen(run.started_at)} · ${run.trigger}`],
    ["Stock as of", run.stock_as_of ?? "n/a"],
    ["SKUs", String(summary.total)],
    ["Rules", run.rules_version],
  ];

  return (
    <div className="space-y-6">
      {problemBanner}
      <StaleBanner stockAsOf={run.stock_as_of} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            {summary.festival_month && (
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800" title="Festival months raise demand by 25% in the cover calculation">
                {monthName(run.planning_month)} festival month · +25% demand
              </span>
            )}
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-slate-400">{k}</dt>
                <dd className="text-sm font-medium text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex gap-2">
          {runButton}
          <a href="/api/export" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">Export CSV</a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/recommendations?status=stockout" className={`${card} p-5 transition hover:border-slate-300 hover:shadow ${attention > 0 ? "border-l-4 border-l-red-500" : ""}`}>
          <div className="text-sm text-slate-500">Need action now</div>
          <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{attention}</div>
          <div className="mt-1 text-xs text-slate-500">{summary.counts.stockout} stockouts + {summary.pending_review} waiting for review</div>
        </Link>
        <Link href="/review" className={`${card} p-5 transition hover:border-slate-300 hover:shadow ${summary.pending_review > 0 ? "border-l-4 border-l-amber-500" : ""}`}>
          <div className="text-sm text-slate-500">Waiting for review</div>
          <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{summary.pending_review}</div>
          <div className="mt-1 text-xs text-slate-500">{summary.pending_review > 0 ? "Open the review queue" : "Nothing for the planner to decide"}</div>
        </Link>
        <div className={`${card} p-5`}>
          <div className="text-sm text-slate-500">Decided by rules alone</div>
          <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{pct}%</div>
          <div className="relative mt-3 h-2 rounded-full bg-slate-100" role="img" aria-label={`${pct}% decided by rules, target ${TARGET * 100}%`}>
            <div className={`h-2 rounded-full ${summary.rules_share >= TARGET ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-400" style={{ left: `${TARGET * 100}%` }} aria-hidden />
          </div>
          <div className="mt-1 text-xs text-slate-500">Target is {TARGET * 100}% or more</div>
        </div>
      </div>

      <section className={`${card} p-5`}>
        <h2 className="text-sm font-semibold text-slate-700">All {summary.total} SKUs by status</h2>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img"
          aria-label={URGENCY.map((s) => `${STATUS_LABEL[s]} ${summary.counts[s]}`).join(", ")}>
          {URGENCY.filter((s) => summary.counts[s] > 0).map((s) => (
            <div key={s} className={STATUS_SOLID[s]} style={{ width: `${(summary.counts[s] / summary.total) * 100}%` }} title={`${STATUS_LABEL[s]}: ${summary.counts[s]}`} />
          ))}
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {URGENCY.map((s) => (
            <li key={s}>
              <Link href={s === "needs_review" ? "/review" : `/recommendations?status=${s}`}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 ${summary.counts[s] === 0 ? "opacity-50" : ""}`}>
                <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${STATUS_SOLID[s]}`} />
                <span>
                  <span className="block text-xl font-semibold leading-tight tabular-nums">{summary.counts[s]}</span>
                  <span className="block text-xs text-slate-500">{STATUS_LABEL[s]}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex gap-3 text-sm">
        <Link href="/recommendations" className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white shadow-sm hover:bg-slate-700">View all recommendations</Link>
        <Link href="/procurement" className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 shadow-sm hover:bg-slate-50">Procurement list</Link>
      </div>
    </div>
  );
}
