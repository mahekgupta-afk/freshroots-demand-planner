import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { SignJWT } from "jose";
import { splitSql } from "@/lib/db/migrate";
import { signToken, verifyToken } from "@/lib/auth/token";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { authenticate, MAX_FAILED_ATTEMPTS } from "@/lib/auth/login";
import type { Query } from "@/lib/db/server";

const SECRET = "x".repeat(40);
const payload = { uid: "u1", role: "planner" as const, name: "Raghav" };

describe("session token", () => {
  it("round-trips", async () => {
    expect(await verifyToken(await signToken(payload, SECRET), SECRET)).toEqual(payload);
  });
  it("rejects a missing token", async () => {
    expect(await verifyToken(undefined, SECRET)).toBeNull();
  });
  it("rejects a tampered token", async () => {
    const t = await signToken(payload, SECRET);
    expect(await verifyToken(t.slice(0, -3) + (t.endsWith("AAA") ? "BBB" : "AAA"), SECRET)).toBeNull();
  });
  it("rejects a token signed with another secret", async () => {
    expect(await verifyToken(await signToken(payload, "y".repeat(40)), SECRET)).toBeNull();
  });
  it("rejects an expired token", async () => {
    const t = await new SignJWT({ ...payload }).setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyToken(t, SECRET)).toBeNull();
  });
  it("rejects an unknown role", async () => {
    const t = await signToken({ ...payload, role: "root" as never }, SECRET);
    expect(await verifyToken(t, SECRET)).toBeNull();
  });
  it("refuses a short secret", async () => {
    await expect(signToken(payload, "short")).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("password rules", () => {
  it("enforces a minimum length", () => {
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("long-enough-pw")).toBeNull();
  });
});

describe("authenticate", () => {
  let query: Query;
  beforeAll(async () => {
    const pg = new PGlite();
    query = async (t, p = []) => (await pg.query(t, p)).rows as Record<string, unknown>[];
    for (const f of ["0001_init.sql", "0002_auth.sql"]) {
      for (const s of splitSql(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"))) await pg.exec(s);
    }
    const hash = await hashPassword("correct-horse-battery");
    await query("insert into profiles (email, full_name, role, password_hash) values ('raghav@freshroots.test','Raghav','planner',$1)", [hash]);
    await query("insert into profiles (email, full_name, role, password_hash, active) values ('gone@freshroots.test','Gone','admin',$1,false)", [hash]);
  });

  it("accepts the right password, case-insensitive email", async () => {
    const r = await authenticate(query, "  Raghav@Freshroots.test ", "correct-horse-battery");
    expect(r).toMatchObject({ ok: true, session: { role: "planner", name: "Raghav" } });
  });
  it("gives the same error for a wrong password and an unknown email", async () => {
    const a = await authenticate(query, "raghav@freshroots.test", "nope");
    const b = await authenticate(query, "nobody@freshroots.test", "nope");
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
  });
  it("rejects a deactivated user even with the right password", async () => {
    expect((await authenticate(query, "gone@freshroots.test", "correct-horse-battery")).ok).toBe(false);
  });
  it("locks the account after repeated failures, even for the right password", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await authenticate(query, "raghav@freshroots.test", "wrong");
    const r = await authenticate(query, "raghav@freshroots.test", "correct-horse-battery");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Too many/);
  });
  it("lets the user back in once the lock expires", async () => {
    await query("update profiles set locked_until = now() - interval '1 minute' where email = 'raghav@freshroots.test'");
    expect((await authenticate(query, "raghav@freshroots.test", "correct-horse-battery")).ok).toBe(true);
  });
});
