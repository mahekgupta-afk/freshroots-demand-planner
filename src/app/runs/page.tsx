import { neonQuery } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/session";
import { getRuns } from "@/lib/data/history";
import { formatWhen } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  running: "bg-amber-100 text-amber-800",
};

export default async function RunsPage() {
  await requireRole("planner", "admin");
  const runs = await getRuns(neonQuery());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Runs</h1>
        <p className="mt-1 text-sm text-slate-600">The last {runs.length} runs, newest first. Failed runs show the reason.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Started</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Stock as of</th><th className="px-3 py-2">AI notes</th><th className="px-3 py-2">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2">{formatWhen(r.started_at)}<div className="text-xs text-slate-500">{r.trigger} · rules {r.rules_version}</div></td>
                <td className="px-3 py-2"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? "bg-slate-100"}`}>{r.status}</span></td>
                <td className="px-3 py-2 text-slate-700">
                  {r.error ? <span className="font-mono text-xs text-red-800">{r.error}</span>
                    : r.counts ? `${r.counts.stockout ?? 0} stockout · ${r.counts.needs_review ?? 0} review · ${r.counts.high_demand ?? 0} high demand · ${r.counts.overstock ?? 0} overstock · ${r.counts.on_track ?? 0} on track` : "–"}
                </td>
                <td className="px-3 py-2">{r.stock_as_of ?? "–"}</td>
                <td className="px-3 py-2 text-slate-600">{r.ai ? (r.ai.attempted === 0 ? (r.ai.skipped_reason ?? "none needed") : `${r.ai.succeeded}/${r.ai.attempted} ok`) : "–"}</td>
                <td className="px-3 py-2 text-slate-600">
                  {r.notify ? (r.notify.sent ? `sent to ${r.notify.recipients}` : (r.notify.error ?? r.notify.skipped ?? "not sent")) : "–"}
                </td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No runs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
