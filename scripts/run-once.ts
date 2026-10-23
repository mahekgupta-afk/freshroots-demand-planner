// Runs one manual pipeline run against DATABASE_URL and prints the summary.
// Usage: npm run run-once
import { executeRun } from "../src/lib/pipeline/execute";

const { runId, summary } = await executeRun("manual");
console.log("run", runId);
console.log(summary);
