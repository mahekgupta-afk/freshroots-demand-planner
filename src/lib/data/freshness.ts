export const MAX_STOCK_AGE_DAYS = 2;

const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

/** Whole calendar days (India time) between a stock snapshot date and now. Null when there is no snapshot. */
export function stockAgeDays(stockAsOf: string | null | undefined, now = new Date()): number | null {
  if (!stockAsOf) return null;
  const a = Date.parse(`${stockAsOf.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${istDate(now)}T00:00:00Z`);
  if (Number.isNaN(a)) return null;
  return Math.round((b - a) / 86_400_000);
}

export const isStale = (age: number | null) => age === null || age > MAX_STOCK_AGE_DAYS;

/** Turn this on once the scheduled SAP export is live: runs on stale stock then fail loudly instead of passing quietly. */
export const requireFreshData = (env: Record<string, string | undefined> = process.env) => env.REQUIRE_FRESH_DATA === "true";
