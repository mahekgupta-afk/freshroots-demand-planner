// Runs the rules engine over data/sample and prints the result table.
// Usage: npm run sample -- [planning_month]   (default: current month)
import { readFileSync } from "node:fs";
import rulesJson from "../config/rules.json";
import { rulesSchema } from "../src/lib/rules/schema";
import { evaluateSku } from "../src/lib/rules/engine";
import { parseSkuMaster, parseWeeklySales, parseStock, totalStockBySku } from "../src/lib/ingest/sap";

const rules = rulesSchema.parse(rulesJson);
const read = (f: string) => readFileSync(new URL(`../data/sample/${f}`, import.meta.url), "utf8");
const month = Number(process.argv[2] ?? new Date().getMonth() + 1);

const skus = parseSkuMaster(read("sku_master.csv")).rows;
const sales = parseWeeklySales(read("weekly_sales.csv")).rows;
const stock = totalStockBySku(parseStock(read("stock.csv")).rows);

console.log(`Rules ${rules.version}, planning month ${month}${rules.festival_months.includes(month) ? " (festival)" : ""}\n`);
console.log("SKU      status       stock  demand/wk  cover  qty   reasons");
for (const s of skus) {
  const weekly = sales.filter((r) => r.sku_id === s.sku_id).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const onHand = stock.find((r) => r.sku_id === s.sku_id)?.on_hand ?? 0;
  const r = evaluateSku(
    { sku_id: s.sku_id, perishable: s.perishable, std_qty: s.std_qty, weekly_sales: weekly.map((w) => w.qty),
      weeks_history: weekly.length, on_hand: onHand, open_po_qty: 0, planning_month: month },
    rules,
  );
  const note = r.status === "needs_review" ? `[${r.rule_status}] ${r.review_reasons.join(" ")}` : r.reasons[0];
  console.log(
    `${s.sku_id}  ${r.status.padEnd(12)} ${String(onHand).padStart(5)}  ${r.weekly_demand.toFixed(1).padStart(8)}  ${r.cover_weeks.toFixed(1).padStart(5)}  ${String(r.recommended_qty ?? "-").padStart(4)}  ${note}`,
  );
}
