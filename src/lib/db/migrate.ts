/** Split a migration file into statements. Supports plain DDL/DML only (no $$ function bodies). */
export function splitSql(text: string): string[] {
  if (text.includes("$$")) throw new Error("splitSql does not support $$ blocks; keep migrations to plain statements");
  return text
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));
}
