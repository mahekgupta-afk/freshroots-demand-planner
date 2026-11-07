import type { Query } from "@/lib/db/server";
import { executeRun } from "./execute";

/** Minimum gap between manual runs. Each run writes to the database and may call Gemini. */
export const RUN_COOLDOWN_SECONDS = 120;

export interface RunNowState {
  kind: "ok" | "wait" | "error";
  message: string;
  /** Changes on every click so the page announces repeated results. */
  at: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "Run now" button's logic. Always returns something the person can read: it never stays silent,
 * and never throws (a failed run is reported, and the dashboard banner shows the reason).
 */
export async function runManually(query: Query, run: typeof executeRun = executeRun): Promise<RunNowState> {
  const at = Date.now();
  try {
    const [recent] = await query(
      `select ceil(extract(epoch from (started_at + make_interval(secs => $1) - now())))::int as wait
         from runs where started_at > now() - make_interval(secs => $1) order by started_at desc limit 1`,
      [RUN_COOLDOWN_SECONDS],
    );
    if (recent) {
      const wait = Math.max(1, Number(recent.wait));
      return { kind: "wait", at, message: `A run started moments ago. Please wait ${plural(wait, "second")} and try again.` };
    }

    const { summary } = await run("manual", query);
    const age = summary.stock_age_days;
    const stale = typeof age === "number" && age > 2;
    return {
      kind: "ok",
      at,
      message:
        `Run finished: ${plural(summary.total, "SKU")} checked, ${plural(summary.counts.stockout, "stockout")}, ` +
        `${summary.counts.needs_review} waiting for review.` +
        (stale ? ` The stock data is ${age} days old, so the results match the last run until new data arrives.` : ""),
    };
  } catch {
    return { kind: "error", at, message: "The run failed. The red banner on the dashboard says why, and the Runs page has the details." };
  }
}
