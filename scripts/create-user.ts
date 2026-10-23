// Create or update a login. The password is typed at a hidden prompt, so it never appears in shell history or logs.
// Usage: npm run create-user -- you@company.com "Full Name" planner|procurement|admin
import readline from "node:readline";
import { neonQuery } from "../src/lib/db/server";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";

const [email, name, role] = process.argv.slice(2);
if (!email || !name || !["planner", "procurement", "admin"].includes(role ?? "")) {
  console.error('Usage: npm run create-user -- email "Full Name" planner|procurement|admin');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL in .env.local first.");
  process.exit(1);
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = (rl as unknown as { _writeToOutput: (s: string) => void });
    let muted = false;
    w._writeToOutput = (s) => { if (!muted) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    muted = true;
  });
}

const pw = await askHidden("Password (min 10 chars): ");
const problem = passwordProblem(pw);
if (problem) { console.error(problem); process.exit(1); }
if (pw !== (await askHidden("Repeat password: "))) { console.error("Passwords do not match."); process.exit(1); }

await neonQuery()(
  `insert into profiles (email, full_name, role, password_hash) values (lower($1), $2, $3, $4)
   on conflict (lower(email)) do update set full_name = excluded.full_name, role = excluded.role,
     password_hash = excluded.password_hash, active = true, failed_attempts = 0, locked_until = null`,
  [email, name, role, await hashPassword(pw)],
);
console.log(`Saved ${email} as ${role}.`);
