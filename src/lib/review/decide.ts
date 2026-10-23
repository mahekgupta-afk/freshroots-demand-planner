import type { Query } from "@/lib/db/server";

export type DecisionInput =
  | { action: "approve"; recId: string; userId: string }
  | { action: "override"; recId: string; userId: string; finalQty: number; reason: string };

export type DecisionResult = { ok: true } | { ok: false; error: string };

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;
export const MAX_QTY = 1_000_000;

/**
 * Record a planner's decision on a SKU waiting for review.
 * Only pending items can be decided, and only once: the UPDATE is conditional, so two people
 * clicking at the same time cannot both succeed.
 */
export async function decide(query: Query, input: DecisionInput): Promise<DecisionResult> {
  let rows;
  if (input.action === "approve") {
    rows = await query(
      `update recommendations
          set review_state = 'approved', final_qty = recommended_qty, decided_by = $2, decided_at = now()
        where id = $1 and review_state = 'pending'
        returning id`,
      [input.recId, input.userId],
    );
  } else {
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) return { ok: false, error: "Give a reason for the override." };
    if (reason.length > MAX_REASON_LENGTH) return { ok: false, error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` };
    if (!Number.isInteger(input.finalQty) || input.finalQty < 0 || input.finalQty > MAX_QTY) {
      return { ok: false, error: "Enter a whole-number quantity of 0 or more. Use 0 to pause." };
    }
    rows = await query(
      `update recommendations
          set review_state = 'overridden', final_qty = $3, override_reason = $4, decided_by = $2, decided_at = now()
        where id = $1 and review_state = 'pending'
        returning id`,
      [input.recId, input.userId, input.finalQty, reason],
    );
  }
  if (rows.length === 0) return { ok: false, error: "This item was already decided or is not waiting for review." };
  return { ok: true };
}
