import { describe, it, expect } from "vitest";
import {
  parseEmails, sendEmail, renderRunEmail, renderFailureEmail, notifierFromEnv, appUrlFromEnv,
  type RunEmailData,
} from "@/lib/email/notify";

const data = (over: Partial<RunEmailData> = {}): RunEmailData => ({
  startedAt: "2026-10-26 01:30:05+00", rulesVersion: "2026-10-22.1", planningMonth: 10, total: 15,
  counts: { stockout: 5, needs_review: 1, high_demand: 0, overstock: 2, on_track: 7 },
  pendingReview: 1, rulesShare: 0.93, festival: true,
  urgent: [{ sku_id: "SKU011", name: "Multigrain Bread 400g", status: "stockout", qty: 500 }],
  aiFailed: 0, appUrl: "https://planner.example.com", ...over,
});

function mockFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return res.clone();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("parseEmails", () => {
  it("splits on commas, semicolons and spaces, lowercases, dedupes", () => {
    expect(parseEmails("A@x.com, b@y.org; a@X.com  c@z.in")).toEqual(["a@x.com", "b@y.org", "c@z.in"]);
  });
  it("drops anything that is not an address", () => {
    expect(parseEmails("nope, @x.com, a@b, ok@fine.com, <script>@x.com")).toEqual(["ok@fine.com"]);
  });
  it("handles empty and missing", () => {
    expect(parseEmails("")).toEqual([]);
    expect(parseEmails(undefined)).toEqual([]);
  });
});

describe("sendEmail", () => {
  const msg = { to: ["a@x.com"], subject: "S", html: "<p>h</p>", text: "t" };

  it("posts to Resend with a bearer key and the full message", async () => {
    const { fn, calls } = mockFetch(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    expect(await sendEmail(msg, { apiKey: "KEY", from: "Planner <p@x.com>", fetchImpl: fn })).toEqual({ ok: true, id: "em_1" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer KEY");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "Planner <p@x.com>", to: ["a@x.com"], subject: "S", html: "<p>h</p>", text: "t" });
  });
  it("reports an HTTP error with Resend's message and does not throw", async () => {
    const { fn } = mockFetch(new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    expect(await sendEmail(msg, { apiKey: "K", from: "f", fetchImpl: fn })).toEqual({ ok: false, error: "Resend HTTP 403: domain not verified" });
  });
  it("reports a network error without throwing", async () => {
    const { fn } = mockFetch(new Error("offline"));
    expect(await sendEmail(msg, { apiKey: "K", from: "f", fetchImpl: fn })).toEqual({ ok: false, error: "offline" });
  });
  it("refuses to send with no recipients, without calling the API", async () => {
    const { fn, calls } = mockFetch(new Response("{}"));
    expect((await sendEmail({ ...msg, to: [] }, { apiKey: "K", from: "f", fetchImpl: fn })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("renderRunEmail", () => {
  it("states the counts, the review link and India-time run date", () => {
    const m = renderRunEmail(data());
    expect(m.subject).toBe("Demand plan 26 Oct 2026, 7:00 am: 5 stockouts, 1 to review");
    expect(m.text).toContain("Stockout: 5");
    expect(m.text).toContain("1 SKU(s) are waiting for review: https://planner.example.com/review");
    expect(m.text).toContain("SKU011 Multigrain Bread 400g (Stockout, order 500)");
    expect(m.html).toContain('href="https://planner.example.com/review"');
    expect(m.text).toMatch(/Festival month \(October\)/);
  });
  it("says so plainly when nothing needs review", () => {
    const m = renderRunEmail(data({ pendingReview: 0 }));
    expect(m.subject).toMatch(/nothing to review/);
    expect(m.text).toContain("Nothing is waiting for review.");
    expect(m.html).not.toContain("/review");
  });
  it("omits links when no app URL is known", () => {
    const m = renderRunEmail(data({ appUrl: null }));
    expect(m.html).not.toContain("href=");
    expect(m.text).not.toContain("http");
  });
  it("mentions AI notes that were unavailable", () => {
    expect(renderRunEmail(data({ aiFailed: 2 })).text).toContain("AI notes were unavailable for 2 SKU(s)");
  });
  it("HTML-escapes product names so a SAP name cannot inject markup", () => {
    const evil = '<img src=x onerror="alert(1)"> & "Co"';
    const m = renderRunEmail(data({ urgent: [{ sku_id: "S<1>", name: evil, status: "stockout", qty: 0 }] }));
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;Co&quot;");
    expect(m.html).toContain("S&lt;1&gt;");
    expect(m.html).toContain("pause");
  });
});

describe("renderFailureEmail", () => {
  it("is loud, includes the error, and escapes it", () => {
    const m = renderFailureEmail({ startedAt: "2026-10-26 01:30:05+00", error: "weekly_sales.csv: <stale>", trigger: "cron", appUrl: "https://p.example.com" });
    expect(m.subject).toMatch(/FAILED/);
    expect(m.text).toContain("weekly_sales.csv: <stale>");
    expect(m.html).toContain("weekly_sales.csv: &lt;stale&gt;");
    expect(m.html).not.toContain("<stale>");
    expect(m.text).toContain("previous successful run");
  });
});

describe("notifierFromEnv", () => {
  const base = { RESEND_API_KEY: "K", NOTIFY_FROM: "p@x.com", NOTIFY_EMAILS: "raghav@x.com, buyer@x.com" };

  it("explains what is missing", () => {
    expect(notifierFromEnv({}).reason).toMatch(/RESEND_API_KEY or NOTIFY_FROM/);
    expect(notifierFromEnv({ ...base, NOTIFY_EMAILS: "garbage" }).reason).toMatch(/no valid addresses/);
    expect(notifierFromEnv(base).notifier).not.toBeNull();
  });
  it("sends run summaries to the notify list and failures to the alert list", async () => {
    const sent: { to: string[]; subject: string }[] = [];
    const fn = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const { notifier } = notifierFromEnv({ ...base, ALERT_EMAILS: "admin@x.com; it@x.com" }, fn);
    await notifier!.run(data());
    await notifier!.failure({ startedAt: "2026-10-26 01:30:05+00", error: "boom", trigger: "cron", appUrl: null });
    expect(sent[0]!.to).toEqual(["raghav@x.com", "buyer@x.com"]);
    expect(sent[1]!.to).toEqual(["admin@x.com", "it@x.com"]);
  });
  it("falls back to the notify list for failures so they are never silent", async () => {
    const sent: { to: string[] }[] = [];
    const fn = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const { notifier } = notifierFromEnv(base, fn);
    await notifier!.failure({ startedAt: "2026-10-26 01:30:05+00", error: "boom", trigger: "cron", appUrl: null });
    expect(sent[0]!.to).toEqual(["raghav@x.com", "buyer@x.com"]);
  });
  it("returns a failed outcome rather than throwing when Resend rejects", async () => {
    const fn = (async () => new Response(JSON.stringify({ message: "nope" }), { status: 422 })) as unknown as typeof fetch;
    const out = await notifierFromEnv(base, fn).notifier!.run(data());
    expect(out).toEqual({ sent: false, recipients: 2, error: "Resend HTTP 422: nope" });
  });
});

describe("appUrlFromEnv", () => {
  it("prefers APP_URL, trims a trailing slash, else uses the Vercel production host", () => {
    expect(appUrlFromEnv({ APP_URL: "https://a.example.com/" })).toBe("https://a.example.com");
    expect(appUrlFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: "p.vercel.app" })).toBe("https://p.vercel.app");
    expect(appUrlFromEnv({})).toBeNull();
  });
});
