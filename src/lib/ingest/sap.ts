import { z } from "zod";

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const num = z.coerce.number().finite().nonnegative();

/** Monday (YYYY-MM-DD) of an ISO week label such as "2026-W27". */
export function isoWeekToMonday(label: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) throw new Error("expected ISO week like 2026-W27");
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) throw new Error("week out of range");
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const week1Monday = Date.UTC(year, 0, 4 - (dow - 1));
  return new Date(week1Monday + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

const isoWeek = z.string().transform((v, ctx) => {
  try { return isoWeekToMonday(v); }
  catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); return z.NEVER; }
});

// Headers are the SAP export's own (matched case-insensitively by parseCsv).
// The export has no first_sale_date or active flag, so those are not read.
export const skuMasterRow = z.object({
  sku_id: z.string().min(1),
  sku_name: z.string().min(1),
  category: z.string().optional(),
  perishability: z.enum(["High", "Low"]),
  standard_reorder_qty: z.coerce.number().int().nonnegative(),
  distributor_id: z.string().optional(),
}).transform((r) => ({
  sku_id: r.sku_id,
  name: r.sku_name,
  perishable: r.perishability === "High",
  std_qty: r.standard_reorder_qty,
}));

export const weeklySalesRow = z.object({
  sku_id: z.string().min(1),
  week: isoWeek,
  units_sold: num,
}).transform((r) => ({ sku_id: r.sku_id, week_start: r.week, qty: r.units_sold }));

export const stockRow = z.object({
  sku_id: z.string().min(1),
  location: z.string().optional(),
  units_on_hand: num,
  as_of_date: isoDate,
}).transform((r) => ({ sku_id: r.sku_id, snapshot_date: r.as_of_date, on_hand: r.units_on_hand, location: r.location }));

export type SkuMasterRow = z.infer<typeof skuMasterRow>;
export type WeeklySalesRow = z.infer<typeof weeklySalesRow>;
export type StockRow = z.infer<typeof stockRow>;

/** Sum stock across locations per SKU and snapshot date. */
export function totalStockBySku(rows: StockRow[]): { sku_id: string; snapshot_date: string; on_hand: number }[] {
  const m = new Map<string, { sku_id: string; snapshot_date: string; on_hand: number }>();
  for (const r of rows) {
    const k = `${r.sku_id}|${r.snapshot_date}`;
    const cur = m.get(k);
    if (cur) cur.on_hand += r.on_hand;
    else m.set(k, { sku_id: r.sku_id, snapshot_date: r.snapshot_date, on_hand: r.on_hand });
  }
  return [...m.values()];
}

export class IngestError extends Error {
  constructor(public file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

export interface ValidateOptions {
  file: string;
  /** Reject the file when more than this share of rows fail. Spec: 5%. */
  maxBadRatio?: number;
}

/** Validate rows against a schema. Throws if the file is empty or too many rows are bad. */
export function validateRows<S extends z.ZodTypeAny>(
  raw: Record<string, string>[],
  schema: S,
  { file, maxBadRatio = 0.05 }: ValidateOptions,
): { rows: z.infer<S>[]; badRows: { line: number; error: string }[] } {
  if (raw.length === 0) throw new IngestError(file, "file is empty");
  const rows: z.infer<S>[] = [];
  const badRows: { line: number; error: string }[] = [];
  raw.forEach((r, i) => {
    const res = schema.safeParse(r);
    if (res.success) rows.push(res.data);
    else badRows.push({ line: i + 2, error: res.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
  });
  if (badRows.length / raw.length > maxBadRatio) {
    const first = badRows[0]!;
    throw new IngestError(
      file,
      `${badRows.length} of ${raw.length} rows are invalid (limit ${maxBadRatio * 100}%). First: line ${first.line}, ${first.error}`,
    );
  }
  return { rows, badRows };
}

/** Reject a file whose last-modified time is more than maxAgeDays old. */
export function assertFresh(file: string, modifiedAt: Date, now: Date, maxAgeDays = 2): void {
  const ageDays = (now.getTime() - modifiedAt.getTime()) / 86_400_000;
  if (ageDays > maxAgeDays) {
    throw new IngestError(file, `stale: last updated ${ageDays.toFixed(1)} days ago (limit ${maxAgeDays})`);
  }
}

export const parseSkuMaster = (csv: string) =>
  validateRows(parseCsv(csv), skuMasterRow, { file: "sku_master.csv" });
export const parseWeeklySales = (csv: string) =>
  validateRows(parseCsv(csv), weeklySalesRow, { file: "weekly_sales.csv" });
export const parseStock = (csv: string) =>
  validateRows(parseCsv(csv), stockRow, { file: "stock.csv" });
