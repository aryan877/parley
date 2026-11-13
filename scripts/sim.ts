import { join } from "node:path";
import { check } from "./sim/check.ts";
import { writeReport } from "./sim/report.ts";

const ROOT = join(import.meta.dir, "..");

if (process.argv.includes("--check")) {
  process.exit((await check()) ? 0 : 1);
}

const report = writeReport(ROOT);
console.log("Simulated strategies, not language models. Full results: docs/SIM.md\n");
for (const line of report.summary) console.log(`- ${line}`);
console.log(`\nwrote docs/SIM.md and ${Object.keys(report.charts).length} charts in docs/sim/`);
