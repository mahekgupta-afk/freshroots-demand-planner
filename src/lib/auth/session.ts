import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { neonQuery } from "@/lib/db/server";
import { SESSION_COOKIE, SESSION_DAYS, signToken, verifyToken, type Role, type SessionPayload } from "./token";

export async function createSession(p: SessionPayload) {
  const token = await signToken(p);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Cookie-only check (no database). Fine for showing a name; use requireUser for anything that matters. */
export async function getSession(): Promise<SessionPayload | null> {
  return verifyToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The real authorization check. Verifies the cookie AND that the account still exists and is active,
 * so deactivating a user cuts off access immediately instead of when their cookie expires.
 */
export const requireUser = cache(async (): Promise<SessionPayload> => {
  const session = await getSession();
  if (!session) redirect("/login");
  const [row] = await neonQuery()("select full_name, role from profiles where id = $1 and active", [session.uid]);
  if (!row) redirect("/login");
  return { uid: session.uid, role: row.role as Role, name: String(row.full_name ?? session.name) };
});

export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}
