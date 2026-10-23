import bcrypt from "bcryptjs";

const COST = 12;
export const hashPassword = (pw: string) => bcrypt.hash(pw, COST);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export const MIN_PASSWORD_LENGTH = 10;
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > 200) return "Password is too long.";
  return null;
}
