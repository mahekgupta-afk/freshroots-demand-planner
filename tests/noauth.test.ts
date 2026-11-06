import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { fileURLToPath } from "node:url";
import { freshDb } from "./helpers/db";
import { seedSample } from "@/lib/db/seed";
import { executeRun } from "@/lib/pipeline/execute";
import { getLatestRun } from "@/lib/data/latest";
import { decide } from "@/lib/review/decide";
import { authDisabled, GUEST_EMAIL } from "@/lib/auth/config";
import { ensureGuest } from "@/lib/auth/guest";
import { signToken } from "@/lib/auth/token";
import { proxy } from "@/proxy";
import type { Query } from "@/lib/db/server";

const req = (path: string, cookie?: string) =>
  new NextRequest(`https://planner.example.com${path}`, cookie ? { headers: { cookie: `fr_session=${cookie}` } } : undefined);

describe("authDisabled", () => {
  it("is on only for the exact string true", () => {
    expect(authDisabled({ AUTH_DISABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1", "yes"]) expect(authDisabled({ AUTH_DISABLED: v })).toBe(false);
  });
});

describe("proxy", () => {
  const saved = { secret: process.env.AUTH_SECRET, off: process.env.AUTH_DISABLED };
  beforeAll(() => { process.env.AUTH_SECRET = "s".repeat(40); });
  afterEach(() => { delete process.env.AUTH_DISABLED; });

  it("with login ON: anonymous pages redirect to /login and anonymous APIs get 401", async () => {
    const page = await proxy(req("/procurement"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://planner.example.com/login");
    expect((await proxy(req("/api/procurement"))).status).toBe(401);
  });
  it("with login ON: a valid session passes", async () => {
    const t = await signToken({ uid: "u", role: "planner", name: "R" });
    const res = await proxy(req("/procurement", t));
    expect(res.headers.get("location")).toBeNull();
  });
  it("with login OFF: everything passes without a session", async () => {
    process.env.AUTH_DISABLED = "true";
    for (const p of ["/", "/procurement", "/runs", "/api/procurement"]) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(200);
      expect(res.headers.get("location"), p).toBeNull();
    }
  });
  it("with login OFF: /login sends people to the app", async () => {
    process.env.AUTH_DISABLED = "true";
    const res = await proxy(req("/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://planner.example.com/");
  });
  it("restores the environment", () => {
    process.env.AUTH_SECRET = saved.secret; if (saved.off) process.env.AUTH_DISABLED = saved.off;
  });
});

describe("guest profile keeps the audit trail", () => {
  let query: Query;
  beforeAll(async () => {
    ({ query } = await freshDb());
    await seedSample(query, fileURLToPath(new URL("../data/sample", import.meta.url)));
    await query("insert into skus (sku_id, name, perishable, std_qty) values ('NEW1','New Launch',false,200)");
    for (const [i, w] of ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].entries())
      await query("insert into weekly_sales (sku_id, week_start, qty) values ('NEW1',$1,$2)", [w, 40 + i]);
    await query("insert into stock_snapshots (sku_id, snapshot_date, on_hand) values ('NEW1','2026-10-19',100)");
    await executeRun("manual", query, { triage: async () => [], notify: null });
  });

  it("creates one guest admin and reuses it", async () => {
    const a = await ensureGuest(query);
    const b = await ensureGuest(query);
    expect(a).toBe(b);
    const rows = await query("select email, role, password_hash from profiles where lower(email) = $1", [GUEST_EMAIL]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "admin", password_hash: null });
  });
  it("the guest cannot be signed in to (no password)", async () => {
    const { authenticate } = await import("@/lib/auth/login");
    expect((await authenticate(query, GUEST_EMAIL, "anything-at-all")).ok).toBe(false);
  });
  it("decisions made while login is off are recorded against Guest", async () => {
    const guest = await ensureGuest(query);
    const { recs } = (await getLatestRun(query))!;
    const pending = recs.find((r) => r.review_state === "pending")!;
    expect(await decide(query, { action: "override", recId: pending.id, userId: guest, finalQty: 40, reason: "Test decision" })).toEqual({ ok: true });
    const after = (await getLatestRun(query))!.recs.find((r) => r.id === pending.id)!;
    expect(after).toMatchObject({ review_state: "overridden", decided_by_name: "Guest", final_qty: 40 });
  });
});
