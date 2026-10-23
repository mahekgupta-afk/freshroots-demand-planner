import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/auth/session";
import { logout } from "./login/actions";

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
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold text-slate-900">Freshroots Demand Planner</Link>
            {session && (
              <>
                <Link href="/" className="text-slate-600 hover:text-slate-900">Dashboard</Link>
                <Link href="/recommendations" className="text-slate-600 hover:text-slate-900">Recommendations</Link>
              </>
            )}
            {session && (
              <form action={logout} className="ml-auto flex items-center gap-3 text-slate-600">
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
