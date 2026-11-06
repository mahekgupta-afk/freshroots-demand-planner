import { isStale, stockAgeDays, MAX_STOCK_AGE_DAYS } from "@/lib/data/freshness";

/** Amber warning when the stock behind a run is older than the limit. Renders nothing when data is fresh. */
export function StaleBanner({ stockAsOf }: { stockAsOf: string | null }) {
  const age = stockAgeDays(stockAsOf);
  if (!isStale(age)) return null;
  return (
    <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong>{age === null ? "No stock date on this run." : `Stock data is ${age} days old (as of ${stockAsOf}).`}</strong>{" "}
      These numbers may not match what is in the warehouse today. The limit is {MAX_STOCK_AGE_DAYS} days. Check that the SAP export is running.
    </div>
  );
}
