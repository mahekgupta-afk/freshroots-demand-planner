import { describe, it, expect } from "vitest";
import { parseCsv, parseSkuMaster, parseWeeklySales, parseStock, assertFresh, IngestError } from "@/lib/ingest/sap";

describe("parseCsv", () => {
  it("handles quotes, commas in fields, CRLF and BOM", () => {
    const rows = parseCsv('﻿sku_id,name\r\nA1,"Chips, salted"\r\nA2,"Say ""hi"""\r\n');
    expect(rows).toEqual([
      { sku_id: "A1", name: "Chips, salted" },
      { sku_id: "A2", name: 'Say "hi"' },
    ]);
  });
});

describe("sku_master.csv", () => {
  const head = "sku_id,name,perishable,std_qty,first_sale_date,active\n";
  it("parses valid rows and converts Y/N", () => {
    const { rows } = parseSkuMaster(head + "A1,Namkeen,N,500,2024-01-01,Y\nA2,Bread,Y,200,,Y\n");
    expect(rows[0]).toMatchObject({ perishable: false, active: true, std_qty: 500 });
    expect(rows[1]).toMatchObject({ perishable: true, first_sale_date: null });
  });
  it("rejects an empty file", () => {
    expect(() => parseSkuMaster(head)).toThrow(IngestError);
  });
  it("rejects when more than 5% of rows are bad", () => {
    const good = Array.from({ length: 18 }, (_, i) => `S${i},N${i},N,100,2024-01-01,Y`).join("\n");
    const bad = "B1,x,MAYBE,100,2024-01-01,Y\nB2,y,N,-5,2024-01-01,Y";
    expect(() => parseSkuMaster(head + good + "\n" + bad)).toThrow(/invalid/);
  });
  it("tolerates a bad-row share at or under 5% and reports the rows", () => {
    const good = Array.from({ length: 19 }, (_, i) => `S${i},N${i},N,100,2024-01-01,Y`).join("\n");
    const { rows, badRows } = parseSkuMaster(head + good + "\nB1,x,MAYBE,100,2024-01-01,Y");
    expect(rows).toHaveLength(19);
    expect(badRows).toHaveLength(1);
    expect(badRows[0]!.line).toBe(21);
  });
});

describe("weekly_sales.csv", () => {
  it("requires Monday week starts and non-negative qty", () => {
    expect(() => parseWeeklySales("sku_id,week_start,qty\nA1,2026-10-06,10\n")).toThrow(/invalid/); // Tuesday
    expect(() => parseWeeklySales("sku_id,week_start,qty\nA1,2026-10-05,-1\n")).toThrow(/invalid/);
    expect(parseWeeklySales("sku_id,week_start,qty\nA1,2026-10-05,10\n").rows[0]!.qty).toBe(10);
  });
});

describe("stock.csv", () => {
  it("parses on_hand as a number", () => {
    expect(parseStock("sku_id,snapshot_date,on_hand\nA1,2026-10-21,340\n").rows[0]!.on_hand).toBe(340);
  });
});

describe("assertFresh", () => {
  const now = new Date("2026-10-22T02:00:00Z");
  it("passes for a file under 2 days old", () => {
    expect(() => assertFresh("stock.csv", new Date("2026-10-21T00:00:00Z"), now)).not.toThrow();
  });
  it("rejects a stale file", () => {
    expect(() => assertFresh("stock.csv", new Date("2026-10-18T00:00:00Z"), now)).toThrow(/stale/);
  });
});
