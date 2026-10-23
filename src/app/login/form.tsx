"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">
        Email
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
