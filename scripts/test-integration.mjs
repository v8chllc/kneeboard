import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// These files require a Journey's own isolated database or Mailpit environment.
export const JOURNEY_ONLY_FILES = new Set([
  "src/db/db-journey.test.ts",
  "src/db/recent-loads.integration.test.ts",
  "src/server/auth-integration.test.ts",
  "src/server/account-settings.integration.test.ts",
  "src/server/mail-delivery.integration.test.ts",
]);

export function inspectResults(report, root = process.cwd()) {
  if (!Array.isArray(report.testResults) || report.testResults.length === 0) {
    return { files: [], errors: ["Vitest returned no test files"] };
  }

  const files = [];
  const errors = [];
  for (const result of report.testResults) {
    const file = path.relative(root, result.name).split(path.sep).join("/");
    const assertions = result.assertionResults;
    if (!Array.isArray(assertions) || assertions.length === 0) {
      errors.push(`${file}: no test results`);
      continue;
    }

    const skipped = assertions.filter((test) => ["skipped", "pending", "todo"].includes(test.status)).length;
    const failed = assertions.filter((test) => test.status !== "passed" && !["skipped", "pending", "todo"].includes(test.status)).length;
    const duration = ((result.endTime - result.startTime) / 1000).toFixed(2);
    files.push({ file, skipped, failed, duration });
    if (skipped > 0 && !JOURNEY_ONLY_FILES.has(file)) {
      errors.push(`${file}: ${skipped} unexpected skipped test(s)`);
    }
    if (failed > 0 || result.status === "failed") {
      errors.push(`${file}: ${failed} failed test(s)`);
    }
  }
  if (report.success !== true) errors.push("Vitest reported failure");
  return { files, errors };
}

function localTestUrl(value) {
  if (!value) throw new Error("TEST_DATABASE_URL must target the local test database");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must target the local test database");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/kneeboard_test" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("TEST_DATABASE_URL must target the local test database");
  }
}

function main() {
  localTestUrl(process.env.TEST_DATABASE_URL);
  const started = performance.now();
  const run = spawnSync("pnpm", ["exec", "vitest", "run", "--no-file-parallelism", "--reporter=json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw run.error;

  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    throw new Error(`Vitest did not return a JSON report (exit ${run.status ?? "unknown"})`);
  }
  const { files, errors } = inspectResults(report);
  for (const { file, skipped, failed, duration } of files) {
    const result = failed > 0 ? "FAIL" : skipped > 0 ? "JOURNEY SKIP" : "PASS";
    console.log(`${result} ${file} (${duration}s${skipped > 0 ? `, ${skipped} skipped` : ""})`);
  }
  console.log(`Vitest duration: ${((performance.now() - started) / 1000).toFixed(2)}s`);
  if (run.status !== 0) errors.push(`Vitest exited ${run.status ?? "without a status"}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
