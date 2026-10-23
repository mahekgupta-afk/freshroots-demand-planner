// One real Gemini call with two made-up SKUs, to prove the request format and key work. Prints results only.
// Usage: npm run triage-smoke   (reads GEMINI_API_KEY and GEMINI_MODEL from .env.local)
import { triageAll, type TriageItem } from "../src/lib/gemini/triage";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!apiKey || !model) {
  console.error("Set GEMINI_API_KEY and GEMINI_MODEL in .env.local first.");
  process.exit(1);
}

const items: TriageItem[] = [
  { sku_id: "DEMO1", name: "Demo New Launch Bar", perishable: false, weekly_sales: [40, 43, 46, 49, 52, 55], on_hand: 90,
    open_po_qty: 0, rule_status: "stockout", rule_qty: 200, planning_month: 10,
    review_reasons: ["New launch: only 6 weeks of history (need 12)."] },
  { sku_id: "DEMO2", name: "Demo Erratic Snack", perishable: true, weekly_sales: [10, 300, 20, 250, 15, 280, 30, 260, 10, 290, 20, 270],
    on_hand: 500, open_po_qty: 100, rule_status: "on_track", rule_qty: null, planning_month: 10,
    review_reasons: ["Erratic sales: coefficient of variation above threshold."] },
];

const logs: { error: string | null; latency_ms: number }[] = [];
const out = await triageAll(items, { apiKey, model, onCall: (l) => { logs.push({ error: l.error, latency_ms: l.latency_ms }); } });
console.log("model:", model, "| calls:", logs.length, "| latency ms:", logs.map((l) => l.latency_ms).join(", "));
for (const l of logs) if (l.error) console.log("call error:", l.error);
console.log(JSON.stringify(out, null, 2));
