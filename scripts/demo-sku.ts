// Adds or removes ONE clearly labelled demo product, so the review queue has something to try.
// Usage: npm run demo-sku -- add      (adds the product and runs the pipeline once)
//        npm run demo-sku -- remove   (deletes the product and every recommendation that mentions it)
import { neonQuery } from "../src/lib/db/server";
import { executeRun } from "../src/lib/pipeline/execute";

const SKU = "DEMO-NEW";
const mode = process.argv[2];
if (mode !== "add" && mode !== "remove") {
  console.error("Usage: npm run demo-sku -- add|remove");
  process.exit(1);
}
const q = neonQuery();

if (mode === "add") {
  await q("insert into skus (sku_id, name, perishable, std_qty) values ($1, 'DEMO: New Launch Bar (sample, safe to delete)', false, 200) on conflict (sku_id) do nothing", [SKU]);
  // Six weeks of sales is under the 12 the rules need, so this is routed to review as a "new launch".
  const weeks = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];
  for (const [i, w] of weeks.entries()) {
    await q("insert into weekly_sales (sku_id, week_start, qty) values ($1, $2, $3) on conflict (sku_id, week_start) do nothing", [SKU, w, 40 + i * 3]);
  }
  await q("insert into stock_snapshots (sku_id, snapshot_date, on_hand) values ($1, '2026-10-19', 90) on conflict (sku_id, snapshot_date) do nothing", [SKU]);
  const { summary } = await executeRun("manual");
  console.log("Added", SKU, "| waiting for review:", summary.counts.needs_review, "| AI:", JSON.stringify(summary.ai));
} else {
  await q("delete from recommendations where sku_id = $1", [SKU]);
  await q("delete from weekly_sales where sku_id = $1", [SKU]);
  await q("delete from stock_snapshots where sku_id = $1", [SKU]);
  await q("delete from skus where sku_id = $1", [SKU]);
  console.log("Removed", SKU);
}
