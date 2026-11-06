import { neonQuery } from "@/lib/db/server";
import { getLatestRun } from "@/lib/data/latest";
import { buildProcurementList } from "@/lib/data/procurement";
import { getSession } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** CSV of what procurement can act on from the latest run. */
export async function GET() {
  if (!(await getSession())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const latest = await getLatestRun(neonQuery());
  if (!latest) return Response.json({ error: "no run yet" }, { status: 404 });
  const { items } = buildProcurementList(latest.recs);
  const body = toCsv(
    ["sku_id", "name", "action", "quantity", "decided_by", "basis", "reason"],
    items.map((i) => [i.sku_id, i.name, i.action, i.action === "order" ? i.qty : 0, i.decided_by ?? "", i.source, i.reason]),
  );
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="procurement-${latest.run.started_at.slice(0, 10)}.csv"`,
    },
  });
}
