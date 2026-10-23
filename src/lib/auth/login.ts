import type { Query } from "@/lib/db/server";
import { checkPassword, hashPassword } from "./password";
import type { Role, SessionPayload } from "./token";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
const GENERIC_ERROR = "Invalid email or password.";

// Compared against when the email is unknown, so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password"));

export type LoginResult = { ok: true; session: SessionPayload } | { ok: false; error: string };

export async function authenticate(query: Query, emailRaw: string, password: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const [user] = await query(
    `select id, full_name, role, password_hash, active,
            (locked_until is not null and locked_until > now()) as locked
       from profiles where lower(email) = $1`,
    [email],
  );

  if (!user || !user.password_hash || !user.active) {
    await checkPassword(password, await getDummyHash());
    return { ok: false, error: GENERIC_ERROR };
  }
  if (user.locked) {
    return { ok: false, error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` };
  }

  if (!(await checkPassword(password, String(user.password_hash)))) {
    await query(
      `update profiles set
         failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
         locked_until = case when failed_attempts + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end
       where id = $1`,
      [user.id, MAX_FAILED_ATTEMPTS, String(LOCK_MINUTES)],
    );
    return { ok: false, error: GENERIC_ERROR };
  }

  await query("update profiles set failed_attempts = 0, locked_until = null where id = $1", [user.id]);
  return {
    ok: true,
    session: { uid: String(user.id), role: user.role as Role, name: String(user.full_name ?? email) },
  };
}
