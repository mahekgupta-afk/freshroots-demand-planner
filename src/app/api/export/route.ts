import { neonQuery } from "@/lib/db/server";
import { getLatestRun } from "@/lib/data/latest";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  // The proxy already blocks anonymous requests; re-check here so the route is safe on its own.
  if (!(await getSession())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const latest = await getLatestRun(neonQuery());
  if (!latest) return Response.json({ error: "no run yet" }, { status: 404 });

  const header = ["sku_id", "name", "status", "review_state", "stock", "weekly_demand", "cover_weeks", "rule_qty", "final_qty", "override_reason", "reason"];
  const lines = latest.recs.map((p) =>
    [p.sku_id, p.name, p.status, p.review_state, Math.round(p.effective_stock), p.weekly_demand.toFixed(1),
     p.cover_weeks === null ? "" : p.cover_weeks.toFixed(1), p.recommended_qty ?? "", p.final_qty ?? "",
     p.override_reason ?? "", p.status === "needs_review" ? p.review_reasons.join(" ") : p.reasons[0]].map(esc).join(","),
  );
  return new Response([header.join(","), ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="recommendations-${latest.run.started_at.slice(0, 10)}.csv"`,
    },
  });
}
