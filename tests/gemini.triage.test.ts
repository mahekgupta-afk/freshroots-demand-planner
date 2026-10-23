import { describe, it, expect } from "vitest";
import { triageAll, SYSTEM_PROMPT, type TriageItem, type CallLog } from "@/lib/gemini/triage";

const item = (id: string): TriageItem => ({
  sku_id: id, name: `Item ${id}`, perishable: false, weekly_sales: [10, 12, 11, 9, 10, 13],
  on_hand: 100, open_po_qty: 0, rule_status: "stockout", rule_qty: 200,
  review_reasons: ["New launch: only 6 weeks of history (need 12)."], planning_month: 10,
});
const items = (n: number) => Array.from({ length: n }, (_, i) => item(`S${i + 1}`));

const good = (id: string, over: object = {}) => ({
  sku_id: id, note: "Only six weeks of history, so the cover estimate is shaky. Check launch-phase sales.",
  suggested_action: "investigate", confidence: "low", ...over,
});
const reply = (results: unknown[]) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ results }) }] } }] }), { status: 200 });

/** Mock fetch that serves a queue of responses and records every request. */
function mockFetch(responses: (Response | Error | ((body: any) => Response))[]) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const next = responses.shift() ?? new Response("{}", { status: 500 });
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(body) : next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const idsIn = (body: any): string[] => JSON.parse(body.contents[0].parts[0].text).skus.map((s: any) => s.sku_id);
const cfg = (fetchImpl: typeof fetch, extra = {}) => ({ apiKey: "test-key", model: "test-model", fetchImpl, retryDelayMs: 0, ...extra });

describe("triageAll", () => {
  it("returns validated notes and calls the right model with the key in a header", async () => {
    const { fn, calls } = mockFetch([reply([good("S1"), good("S2")])]);
    const out = await triageAll(items(2), cfg(fn));
    expect(out.map((o) => [o.sku_id, o.failed, o.action, o.confidence])).toEqual([
      ["S1", false, "investigate", "low"], ["S2", false, "investigate", "low"],
    ]);
    expect(calls[0]!.url).toContain("/models/test-model:generateContent");
    expect(calls[0]!.url).not.toContain("test-key"); // never in the URL
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("test-key");
  });

  it("uses low temperature, JSON output and the planner prompt that forbids quantities", async () => {
    const { fn, calls } = mockFetch([reply([good("S1")])]);
    await triageAll(items(1), cfg(fn));
    const b = calls[0]!.body;
    expect(b.generationConfig.temperature).toBe(0.2);
    expect(b.generationConfig.responseMimeType).toBe("application/json");
    expect(b.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).toMatch(/Do NOT recommend a specific order quantity/);
  });

  it("sends only the allowed fields", async () => {
    const { fn, calls } = mockFetch([reply([good("S1")])]);
    await triageAll(items(1), cfg(fn));
    const sent = JSON.parse(calls[0]!.body.contents[0].parts[0].text).skus[0];
    expect(Object.keys(sent).sort()).toEqual([
      "name", "open_po_qty", "perishable", "planning_month", "rules_result", "rules_suggested_order_qty",
      "sku_id", "stock_on_hand", "weekly_sales_oldest_to_latest", "why_flagged",
    ]);
  });

  it("retries once when the first answer is malformed JSON", async () => {
    const bad = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json {" }] } }] }), { status: 200 });
    const { fn, calls } = mockFetch([bad, reply([good("S1")])]);
    const out = await triageAll(items(1), cfg(fn));
    expect(calls).toHaveLength(2);
    expect(out[0]!.failed).toBe(false);
  });

  it("rejects notes over 60 words, retries, then flags the SKU instead of throwing", async () => {
    const long = Array.from({ length: 61 }, () => "word").join(" ");
    const { fn, calls } = mockFetch([reply([good("S1", { note: long })]), reply([good("S1", { note: long })])]);
    const out = await triageAll(items(1), cfg(fn));
    expect(calls).toHaveLength(2); // exactly one retry, never more
    expect(out[0]).toMatchObject({ sku_id: "S1", note: null, failed: true });
  });

  it("flags failures after one retry on HTTP errors and network errors, without throwing", async () => {
    const { fn: f500 } = mockFetch([new Response("{}", { status: 500 }), new Response("{}", { status: 429 })]);
    expect((await triageAll(items(1), cfg(f500)))[0]!.failed).toBe(true);
    const { fn: fNet } = mockFetch([new Error("network down"), new Error("network down")]);
    expect((await triageAll(items(1), cfg(fNet)))[0]!.failed).toBe(true);
  });

  it("retries only the SKUs that were missing from a partial answer", async () => {
    const { fn, calls } = mockFetch([reply([good("S1")]), reply([good("S2")])]);
    const out = await triageAll(items(2), cfg(fn));
    expect(idsIn(calls[1]!.body)).toEqual(["S2"]);
    expect(out.every((o) => !o.failed)).toBe(true);
  });

  it("ignores unknown and duplicate sku_ids in the answer", async () => {
    const { fn } = mockFetch([reply([good("S1", { note: "first" }), good("S1", { note: "dup" }), good("HACK")])]);
    const out = await triageAll(items(1), cfg(fn));
    expect(out).toHaveLength(1);
    expect(out[0]!.note).toBe("first");
  });

  it("rejects an invalid action or confidence value", async () => {
    const { fn } = mockFetch([reply([good("S1", { suggested_action: "order 500 units" })]), reply([good("S1", { confidence: "certain" })])]);
    expect((await triageAll(items(1), cfg(fn)))[0]!.failed).toBe(true);
  });

  it("splits work into batches", async () => {
    const { fn, calls } = mockFetch([]);
    const respond = (body: any) => reply(idsIn(body).map((id) => good(id)));
    const many = Array.from({ length: 20 }, () => respond);
    const m = mockFetch(many);
    const out = await triageAll(items(20), cfg(m.fn, { batchSize: 8, concurrency: 2 }));
    expect(m.calls).toHaveLength(3); // 8 + 8 + 4
    expect(m.calls.map((c) => idsIn(c.body).length).sort()).toEqual([4, 8, 8]);
    expect(out).toHaveLength(20);
    expect(out.every((o) => !o.failed)).toBe(true);
    void fn; void calls;
  });

  it("reports every call to onCall, including failures, and survives onCall throwing", async () => {
    const logs: CallLog[] = [];
    const { fn } = mockFetch([new Response("{}", { status: 500 }), reply([good("S1")])]);
    const out = await triageAll(items(1), cfg(fn, { onCall: (l: CallLog) => { logs.push(l); throw new Error("audit db down"); } }));
    expect(out[0]!.failed).toBe(false);
    expect(logs).toHaveLength(2);
    expect(logs[0]!.error).toMatch(/HTTP 500/);
    expect(logs[1]!.error).toBeNull();
    expect(logs[1]!.skus).toEqual(["S1"]);
  });

  it("waits before retrying so an overloaded service can recover", async () => {
    const { fn } = mockFetch([new Response("{}", { status: 503 }), reply([good("S1")])]);
    const t0 = Date.now();
    const out = await triageAll(items(1), cfg(fn, { retryDelayMs: 120 }));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
    expect(out[0]!.failed).toBe(false);
  });

  it("stops starting work after the deadline and flags the rest, without calling the API", async () => {
    const { fn, calls } = mockFetch([]);
    const out = await triageAll(items(5), cfg(fn, { deadlineAt: Date.now() - 1 }));
    expect(calls).toHaveLength(0);
    expect(out).toHaveLength(5);
    expect(out.every((o) => o.failed && o.note === null)).toBe(true);
  });

  it("skips the retry when the deadline passes during the retry pause", async () => {
    const { fn, calls } = mockFetch([new Response("{}", { status: 503 }), reply([good("S1")])]);
    const out = await triageAll(items(1), cfg(fn, { deadlineAt: Date.now() + 40, retryDelayMs: 150 }));
    expect(calls).toHaveLength(1); // the retry never fired
    expect(out[0]).toMatchObject({ failed: true, note: null });
  });

  it("handles no items", async () => {
    const { fn, calls } = mockFetch([]);
    expect(await triageAll([], cfg(fn))).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
