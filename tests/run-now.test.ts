import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { freshDb } from "./helpers/db";
import { seedSample } from "@/lib/db/seed";
import { runManually, RUN_COOLDOWN_SECONDS } from "@/lib/pipeline/run-now";
import type { Query } from "@/lib/db/server";

let query: Query;
beforeAll(async () => { ({ query } = await freshDb()); });
beforeEach(async () => {
  await query("truncate ai_calls, recommendations, runs, weekly_sales, stock_snapshots, skus restart identity cascade");
  await seedSample(query, fileURLToPath(new URL("../data/sample", import.meta.url)));
});

describe("runManually", () => {
  it("runs, saves a run, and says what it found in plain words", async () => {
    const res = await runManually(query);
    expect(res.kind).toBe("ok");
    expect(res.message).toMatch(/^Run finished: 15 SKUs checked, 5 stockouts, 0 waiting for review\./);
    expect((await query("select count(*)::int as n from runs where trigger = 'manual' and status = 'done'"))[0]!.n).toBe(1);
  });

  it("tells you when the stock data is old, so identical numbers are explained", async () => {
    const res = await runManually(query);
    expect(res.message).toMatch(/The stock data is \d+ days old, so the results match the last run/);
  });

  it("does not repeat the stale note when the stock is fresh", async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await query("update stock_snapshots set snapshot_date = $1", [today]);
    expect((await runManually(query)).message).not.toMatch(/days old/);
  });

  it("a second click inside the cooldown is refused with a visible, specific message", async () => {
    expect((await runManually(query)).kind).toBe("ok");
    const again = await runManually(query);
    expect(again.kind).toBe("wait");
    expect(again.message).toMatch(/Please wait \d+ seconds? and try again/);
    expect((await query("select count(*)::int as n from runs"))[0]!.n).toBe(1); // no second run was started
  });

  it("the wait never exceeds the cooldown and is at least one second", async () => {
    await runManually(query);
    const wait = Number(/wait (\d+) second/.exec((await runManually(query)).message)![1]);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(RUN_COOLDOWN_SECONDS);
  });

  it("runs again once the cooldown has passed", async () => {
    await runManually(query);
    await query("update runs set started_at = now() - interval '5 minutes'");
    expect((await runManually(query)).kind).toBe("ok");
  });

  it("a failed run is reported, not thrown, and the reason is not leaked into the message", async () => {
    const res = await runManually(query, async () => { throw new Error("password authentication failed for user neondb_owner"); });
    expect(res.kind).toBe("error");
    expect(res.message).toMatch(/The run failed/);
    expect(res.message).not.toMatch(/neondb|password/i);
  });

  it("a broken database check is reported rather than thrown", async () => {
    const broken: Query = async () => { throw new Error("connection refused"); };
    expect((await runManually(broken)).kind).toBe("error");
  });

  it("every result carries a fresh timestamp so repeated messages are re-announced", async () => {
    const a = await runManually(query);
    await new Promise((r) => setTimeout(r, 5));
    const b = await runManually(query);
    expect(b.at).toBeGreaterThan(a.at);
  });
});
