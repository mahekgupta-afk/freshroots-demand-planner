import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "fr_session";
export const SESSION_DAYS = 7;

export type Role = "planner" | "procurement" | "admin";
export interface SessionPayload {
  uid: string;
  role: Role;
  name: string;
}

function key(secret = process.env.AUTH_SECRET) {
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set to a string of at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signToken(p: SessionPayload, secret?: string, days = SESSION_DAYS): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(key(secret));
}

/** Returns the payload, or null for a missing, tampered or expired token. Never throws on bad input. */
export async function verifyToken(token: string | undefined, secret?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const { uid, role, name } = payload as Partial<SessionPayload>;
    if (typeof uid !== "string" || typeof name !== "string") return null;
    if (role !== "planner" && role !== "procurement" && role !== "admin") return null;
    return { uid, role, name };
  } catch {
    return null;
  }
}
