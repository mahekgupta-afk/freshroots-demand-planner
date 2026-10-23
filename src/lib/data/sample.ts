import { readFileSync } from "node:fs";
import path from "node:path";
import rulesJson from "../../../config/rules.json";
import { rulesSchema } from "@/lib/rules/schema";
import { parseSkuMaster, parseWeeklySales, parseStock, totalStockBySku } from "@/lib/ingest/sap";
import { runPipeline, planningMonthIST } from "@/lib/pipeline/run";

export const rules = rulesSchema.parse(rulesJson);

const read = (f: string) => readFileSync(path.join(process.cwd(), "data", "sample", f), "utf8");

/** Runs the pipeline over data/sample. Used until the database is connected. */
export function loadSampleRun(now = new Date()) {
  const result = runPipeline({
    rules,
    planningMonth: planningMonthIST(now),
    skus: parseSkuMaster(read("sku_master.csv")).rows,
    sales: parseWeeklySales(read("weekly_sales.csv")).rows,
    stock: totalStockBySku(parseStock(read("stock.csv")).rows),
    openPos: [],
  });
  return { ...result, rulesVersion: rules.version, source: "sample" as const };
}
