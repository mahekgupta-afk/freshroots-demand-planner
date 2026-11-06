import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/auth/session";
import { logout } from "./login/actions";
import { NavLink } from "@/components/nav-link";
import { authDisabled } from "@/lib/auth/config";

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Rules-based demand planning with human review",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-6 py-3">
            <Link href="/" className="mr-4 flex items-center gap-2 font-semibold text-slate-900">
              <span aria-hidden className="grid size-7 place-items-center rounded-md bg-emerald-600 text-sm text-white">F</span>
              <span className="hidden sm:inline">Demand Planner</span>
            </Link>
            {session && (
              <>
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/recommendations">Recommendations</NavLink>
                <NavLink href="/review">Review</NavLink>
                <NavLink href="/procurement">Procurement</NavLink>
                {(session.role === "planner" || session.role === "admin") && <NavLink href="/runs">Runs</NavLink>}
              </>
            )}
            {session && authDisabled() && <span className="ml-auto text-xs text-slate-400">Login is off</span>}
            {session && !authDisabled() && (
              <form action={logout} className="ml-auto flex items-center gap-3 text-sm text-slate-600">
                <span>{session.name} <span className="text-xs text-slate-400">({session.role})</span></span>
                <button className="underline hover:text-slate-900">Sign out</button>
              </form>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
