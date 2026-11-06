"use server";

import { revalidatePath } from "next/cache";
import { neonQuery } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/session";
import { decide } from "@/lib/review/decide";
import { executeRun } from "@/lib/pipeline/execute";

type State = { error?: string; done?: boolean } | undefined;

export async function approve(_prev: State, formData: FormData): Promise<State> {
  const user = await requireRole("planner", "admin");
  const res = await decide(neonQuery(), { action: "approve", recId: String(formData.get("id")), userId: user.uid });
  if (!res.ok) return { error: res.error };
  revalidatePath("/review");
  revalidatePath("/");
  return { done: true };
}

export async function override(_prev: State, formData: FormData): Promise<State> {
  const user = await requireRole("planner", "admin");
  const qtyRaw = String(formData.get("qty") ?? "").trim();
  const res = await decide(neonQuery(), {
    action: "override",
    recId: String(formData.get("id")),
    userId: user.uid,
    finalQty: qtyRaw === "" ? NaN : Number(qtyRaw),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/review");
  revalidatePath("/");
  return { done: true };
}

/** Minimum gap between manual runs. Each run writes to the database and may call Gemini. */
const RUN_COOLDOWN_MINUTES = 2; // not exported: a "use server" file may only export async functions

export async function runNow() {
  await requireRole("planner", "admin");
  const [recent] = await neonQuery()(
    "select 1 as hit from runs where started_at > now() - ($1 || ' minutes')::interval limit 1",
    [String(RUN_COOLDOWN_MINUTES)],
  );
  if (!recent) await executeRun("manual");
  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/recommendations");
}
