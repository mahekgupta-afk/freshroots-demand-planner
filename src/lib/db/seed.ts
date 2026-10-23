import { readFileSync } from "node:fs";
import { parseSkuMaster, parseWeeklySales, parseStock, totalStockBySku } from "@/lib/ingest/sap";
import type { Query } from "./server";

/** Upserts the SAP sample files into Postgres. Safe to re-run. */
export async function seedSample(query: Query, dir: string) {
  const read = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
  const skus = parseSkuMaster(read("sku_master.csv")).rows.map((r) => ({ ...r, active: true }));
  const sales = parseWeeklySales(read("weekly_sales.csv")).rows;
  const stock = totalStockBySku(parseStock(read("stock.csv")).rows);

  await query(
    `insert into skus (sku_id, name, perishable, std_qty, active)
     select sku_id, name, perishable, std_qty, active from jsonb_populate_recordset(null::skus, $1::jsonb)
     on conflict (sku_id) do update set name = excluded.name, perishable = excluded.perishable,
       std_qty = excluded.std_qty, active = excluded.active`,
    [JSON.stringify(skus)],
  );
  await query(
    `insert into weekly_sales (sku_id, week_start, qty)
     select sku_id, week_start, qty from jsonb_populate_recordset(null::weekly_sales, $1::jsonb)
     on conflict (sku_id, week_start) do update set qty = excluded.qty`,
    [JSON.stringify(sales)],
  );
  await query(
    `insert into stock_snapshots (sku_id, snapshot_date, on_hand)
     select sku_id, snapshot_date, on_hand from jsonb_populate_recordset(null::stock_snapshots, $1::jsonb)
     on conflict (sku_id, snapshot_date) do update set on_hand = excluded.on_hand`,
    [JSON.stringify(stock)],
  );
  return { skus: skus.length, weekly_sales: sales.length, stock_snapshots: stock.length };
}
