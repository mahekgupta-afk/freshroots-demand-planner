import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/token";

// Optimistic gate only: it checks the cookie signature, not the database.
// Real authorization happens in requireUser()/requireRole() inside pages and routes.
export async function proxy(req: NextRequest) {
  const session = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // /api/cron/* is excluded: it authenticates with CRON_SECRET, not a user session.
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};
