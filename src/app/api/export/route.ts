import { loadSampleRun } from "@/lib/data/sample";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const { planned, rulesVersion } = loadSampleRun();
  const header = ["sku_id", "name", "status", "on_hand", "open_po_qty", "weekly_demand", "cover_weeks", "recommended_qty", "reason"];
  const lines = planned.map((p) =>
    [p.sku_id, p.name, p.status, p.on_hand, p.open_po_qty, p.weekly_demand.toFixed(1),
     Number.isFinite(p.cover_weeks) ? p.cover_weeks.toFixed(1) : "", p.recommended_qty ?? "",
     p.status === "needs_review" ? p.review_reasons.join(" ") : p.reasons[0]].map(esc).join(","),
  );
  return new Response([header.join(","), ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="recommendations-${rulesVersion}.csv"`,
    },
  });
}
