/**
 * Login switch. When AUTH_DISABLED is exactly "true", every visitor is treated as an anonymous admin ("Guest").
 * Leave it unset (or any other value) to require a login. The cron route is NOT affected: it has its own secret.
 */
export const authDisabled = (env: Record<string, string | undefined> = process.env) => env.AUTH_DISABLED === "true";

export const GUEST_EMAIL = "guest@freshroots.local";
export const GUEST_NAME = "Guest";
