import type { Query } from "@/lib/db/server";
import { GUEST_EMAIL, GUEST_NAME } from "./config";

/**
 * The profile that decisions are recorded against while login is off, so the audit trail
 * (decided_by) still works. Created on first use.
 */
export async function ensureGuest(query: Query): Promise<string> {
  const [row] = await query(
    `insert into profiles (email, full_name, role, password_hash, active)
     values ($1, $2, 'admin', null, true)
     on conflict (lower(email)) do update set active = true
     returning id`,
    [GUEST_EMAIL, GUEST_NAME],
  );
  return String(row!.id);
}
