"use client";

import { useActionState } from "react";
import { runNow } from "@/app/review/actions";

const TONE = { ok: "text-emerald-800", wait: "text-amber-800", error: "text-red-700" } as const;

/** Starts a run and says what happened: progress while it works, then a plain-language result. */
export function RunNowButton({ children }: { children?: React.ReactNode }) {
  const [state, action, pending] = useActionState(runNow, undefined);
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex gap-2">
        <form action={action}>
          <button
            disabled={pending}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? "Running…" : "Run now"}
          </button>
        </form>
        {children}
      </div>
      <p role="status" aria-live="polite" className={`max-w-sm text-xs sm:text-right ${pending ? "text-slate-500" : state ? TONE[state.kind] : ""}`}>
        {pending ? "Checking every SKU. This takes about 10 seconds." : state?.message}
      </p>
    </div>
  );
}
