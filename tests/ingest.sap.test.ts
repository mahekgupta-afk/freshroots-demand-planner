import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseCsv, parseSkuMaster, parseWeeklySales, parseStock, assertFresh,
  isoWeekToMonday, totalStockBySku, IngestError,
} from "@/lib/ingest/sap";

const sample = (f: string) => readFileSync(new URL(`../data/sample/${f}`, import.meta.url), "utf8");

describe("parseCsv", () => {
  it("handles quotes, commas in fields, CRLF and BOM", () => {
    const rows = parseCsv('﻿sku_id,name\r\nA1,"Chips, salted"\r\nA2,"Say ""hi"""\r\n');
    expect(rows).toEqual([
      { sku_id: "A1", name: "Chips, salted" },
      { sku_id: "A2", name: 'Say "hi"' },
    ]);
  });
});

describe("isoWeekToMonday", () => {
  it("converts ISO weeks to Mondays", () => {
    expect(isoWeekToMonday("2026-W27")).toBe("2026-06-29");
    expect(isoWeekToMonday("2026-W42")).toBe("2026-10-12");
    expect(isoWeekToMonday("2026-W01")).toBe("2025-12-29");
  });
  it("rejects bad labels", () => {
    expect(() => isoWeekToMonday("2026-27")).toThrow();
    expect(() => isoWeekToMonday("2026-W60")).toThrow();
  });
});

const head = "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\n";

describe("SKU master", () => {
  it("maps High perishability to perishable and renames fields", () => {
    const { rows } = parseSkuMaster(head + "A1,Namkeen,Snack,Low,500,Units,D1\nA2,Bread,Staple,High,200,Units,D1\n");
    expect(rows[0]).toEqual({ sku_id: "A1", name: "Namkeen", perishable: false, std_qty: 500 });
    expect(rows[1]!.perishable).toBe(true);
  });
  it("rejects an empty file", () => {
    expect(() => parseSkuMaster(head)).toThrow(IngestError);
  });
  it("rejects when more than 5% of rows are bad", () => {
    const good = Array.from({ length: 18 }, (_, i) => `S${i},N${i},Snack,Low,100,Units,D1`).join("\n");
    const bad = "B1,x,Snack,Medium,100,Units,D1\nB2,y,Snack,Low,-5,Units,D1";
    expect(() => parseSkuMaster(head + good + "\n" + bad)).toThrow(/invalid/);
  });
  it("tolerates 5% bad rows and reports them", () => {
    const good = Array.from({ length: 19 }, (_, i) => `S${i},N${i},Snack,Low,100,Units,D1`).join("\n");
    const { rows, badRows } = parseSkuMaster(head + good + "\nB1,x,Snack,Medium,100,Units,D1");
    expect(rows).toHaveLength(19);
    expect(badRows[0]!.line).toBe(21);
  });
});

describe("weekly sales", () => {
  it("converts ISO week labels to Monday dates", () => {
    const { rows } = parseWeeklySales("SKU_ID,Week,Units_Sold\nA1,2026-W42,259\n");
    expect(rows[0]).toEqual({ sku_id: "A1", week_start: "2026-10-12", qty: 259 });
  });
  it("rejects negative units", () => {
    expect(() => parseWeeklySales("SKU_ID,Week,Units_Sold\nA1,2026-W42,-1\n")).toThrow(/invalid/);
  });
});

describe("stock", () => {
  it("sums across locations", () => {
    const { rows } = parseStock("SKU_ID,Location,Units_On_Hand,As_Of_Date\nA1,Pune,100,2026-10-19\nA1,Goa,50,2026-10-19\n");
    expect(totalStockBySku(rows)).toEqual([{ sku_id: "A1", snapshot_date: "2026-10-19", on_hand: 150 }]);
  });
});

describe("assertFresh", () => {
  const now = new Date("2026-10-22T02:00:00Z");
  it("passes under 2 days", () => {
    expect(() => assertFresh("stock.csv", new Date("2026-10-21T00:00:00Z"), now)).not.toThrow();
  });
  it("rejects stale", () => {
    expect(() => assertFresh("stock.csv", new Date("2026-10-18T00:00:00Z"), now)).toThrow(/stale/);
  });
});

describe("real sample files", () => {
  it("all parse with zero bad rows", () => {
    expect(parseSkuMaster(sample("sku_master.csv")).rows).toHaveLength(15);
    expect(parseWeeklySales(sample("weekly_sales.csv")).rows).toHaveLength(240);
    expect(parseStock(sample("stock.csv")).badRows).toHaveLength(0);
  });
});
