import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { freshDb } from "./helpers/db";
import { seedSample } from "@/lib/db/seed";
import { executeRun } from "@/lib/pipeline/execute";
import { getRunProblem } from "@/lib/data/latest";
import type { Query } from "@/lib/db/server";
import type { Notifier, RunEmailData, FailureEmailData } from "@/lib/email/notify";

let query: Query;
beforeAll(async () => {
  ({ query } = await freshDb()); // one database per file; each test resets the data below
});
beforeEach(async () => {
  await query("truncate ai_calls, recommendations, runs, weekly_sales, stock_snapshots, skus restart identity cascade");
  await seedSample(query, fileURLToPath(new URL("../data/sample", import.meta.url)));
});

function fakeNotifier(opts: { runResult?: "ok" | "fail" | "throw" } = {}) {
  const runs: RunEmailData[] = [];
  const failures: FailureEmailData[] = [];
  const n: Notifier = {
    run: async (d) => {
      runs.push(d);
      if (opts.runResult === "throw") throw new Error("smtp exploded");
      return opts.runResult === "fail" ? { sent: false, recipients: 2, error: "Resend HTTP 403" } : { sent: true, recipients: 2 };
    },
    failure: async (d) => { failures.push(d); return { sent: true, recipients: 1 }; },
  };
  return { n, runs, failures };
}
const summaryOf = async () => (await query("select summary from runs order by started_at desc limit 1"))[0]!.summary as { notify?: Record<string, unknown> };
const noAi = { triage: async () => [] };

describe("run emails", () => {
  it("a scheduled run sends one summary with the real numbers and records it", async () => {
    const f = fakeNotifier();
    await executeRun("cron", query, { ...noAi, notify: f.n, appUrl: "https://p.example.com" });
    expect(f.runs).toHaveLength(1);
    expect(f.runs[0]).toMatchObject({ total: 15, appUrl: "https://p.example.com", rulesVersion: expect.any(String) });
    expect(f.runs[0]!.counts.stockout).toBe(5);
    expect(f.runs[0]!.urgent.length).toBeLessThanOrEqual(5);
    expect(f.runs[0]!.urgent[0]!.status).toBe("stockout");
    expect((await summaryOf()).notify).toEqual({ sent: true, recipients: 2 });
  });

  it("a manual run does not send email", async () => {
    const f = fakeNotifier();
    const { summary } = await executeRun("manual", query, { ...noAi, notify: f.n });
    expect(f.runs).toHaveLength(0);
    expect(summary.notify).toMatchObject({ sent: false, skipped: "manual run" });
  });

  it("when email is not configured the run still completes and says why", async () => {
    const saved = [process.env.RESEND_API_KEY, process.env.NOTIFY_FROM];
    delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_FROM;
    try {
      const { summary } = await executeRun("cron", query, noAi);
      expect(summary.notify).toMatchObject({ sent: false, skipped: expect.stringMatching(/RESEND_API_KEY/) });
    } finally {
      if (saved[0]) process.env.RESEND_API_KEY = saved[0];
      if (saved[1]) process.env.NOTIFY_FROM = saved[1];
    }
  });

  it("an email failure does not fail the run and is recorded", async () => {
    const f = fakeNotifier({ runResult: "fail" });
    await executeRun("cron", query, { ...noAi, notify: f.n });
    expect((await query("select status from runs"))[0]!.status).toBe("done");
    expect((await summaryOf()).notify).toMatchObject({ sent: false, error: "Resend HTTP 403" });
  });

  it("a notifier that throws does not fail the run", async () => {
    const f = fakeNotifier({ runResult: "throw" });
    const res = await executeRun("cron", query, { ...noAi, notify: f.n });
    expect(res.runId).toBeTruthy();
    expect((await query("select status from runs"))[0]!.status).toBe("done");
  });
});

describe("failure alerts", () => {
  beforeEach(async () => { await query("update skus set active = false"); });

  it("a failed run alerts, still throws the original error, and marks the run failed", async () => {
    const f = fakeNotifier();
    await expect(executeRun("cron", query, { ...noAi, notify: f.n })).rejects.toThrow(/No active SKUs/);
    expect(f.failures).toHaveLength(1);
    expect(f.failures[0]).toMatchObject({ trigger: "cron", error: expect.stringMatching(/No active SKUs/) });
    expect(f.runs).toHaveLength(0);
    const [r] = await query("select status, error, summary from runs");
    expect(r!.status).toBe("failed");
    expect((r!.summary as { notify: unknown }).notify).toEqual({ sent: true, recipients: 1 });
  });

  it("alerts for a failed manual run too", async () => {
    const f = fakeNotifier();
    await expect(executeRun("manual", query, { ...noAi, notify: f.n })).rejects.toThrow();
    expect(f.failures).toHaveLength(1);
  });

  it("a broken alert sender does not mask the real error", async () => {
    const n: Notifier = { run: async () => ({ sent: false, recipients: 0 }), failure: async () => { throw new Error("alert sender down"); } };
    await expect(executeRun("cron", query, { ...noAi, notify: n })).rejects.toThrow(/No active SKUs/);
  });
});

describe("getRunProblem", () => {
  it("is null with no runs and after a good run", async () => {
    expect(await getRunProblem(query)).toBeNull();
    await executeRun("manual", query, { ...noAi, notify: null });
    expect(await getRunProblem(query)).toBeNull();
  });
  it("reports the latest run when it failed, and clears once a later run succeeds", async () => {
    await executeRun("manual", query, { ...noAi, notify: null });
    await query("update skus set active = false");
    await expect(executeRun("manual", query, { ...noAi, notify: null })).rejects.toThrow();
    expect(await getRunProblem(query)).toMatchObject({ kind: "failed", error: expect.stringMatching(/No active SKUs/) });
    await query("update skus set active = true");
    await executeRun("manual", query, { ...noAi, notify: null });
    expect(await getRunProblem(query)).toBeNull();
  });
  it("reports a run that started long ago and never finished", async () => {
    await query("insert into runs (planning_month, rules_version, trigger, status, started_at) values (10, 'x', 'cron', 'running', now() - interval '30 minutes')");
    expect(await getRunProblem(query)).toMatchObject({ kind: "stuck" });
  });
  it("does not flag a run that only just started", async () => {
    await query("insert into runs (planning_month, rules_version, trigger, status) values (10, 'x', 'cron', 'running')");
    expect(await getRunProblem(query)).toBeNull();
  });
});
