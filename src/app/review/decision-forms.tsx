"use client";

import { useActionState } from "react";
import { approve, override } from "./actions";

export function DecisionForms({ id, suggested }: { id: string; suggested: number | null }) {
  const [aState, aAction, aPending] = useActionState(approve, undefined);
  const [oState, oAction, oPending] = useActionState(override, undefined);
  const field = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  const busy = aPending || oPending;

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <form action={aAction} className="flex items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <button disabled={busy} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
          Approve rule suggestion{suggested === null ? " (no order)" : suggested === 0 ? " (pause)" : ` (order ${suggested})`}
        </button>
        {aState?.error && <span role="alert" className="text-sm text-red-700">{aState.error}</span>}
      </form>

      <form action={oAction} className="flex flex-wrap items-start gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="qty" type="number" min={0} step={1} inputMode="numeric" placeholder="Qty (0 = pause)" required className={`${field} w-40`} aria-label="Override quantity" />
        <input name="reason" type="text" maxLength={500} placeholder="Reason for override (required)" required className={`${field} min-w-64 flex-1`} aria-label="Override reason" />
        <button disabled={busy} className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60">
          Override
        </button>
        {oState?.error && <p role="alert" className="w-full text-sm text-red-700">{oState.error}</p>}
      </form>
    </div>
  );
}
