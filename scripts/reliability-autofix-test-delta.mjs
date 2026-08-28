import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

function normalizeLocation(value) {
  const testsIndex = value.lastIndexOf("/tests/");
  const relative = testsIndex >= 0 ? value.slice(testsIndex + 1) : value;
  return relative.replace(/:\d+:\d+$/, "");
}

export function parseTapResult(tap) {
  const failures = new Map();
  const lines = String(tap ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^not ok \d+ - (.+)$/);
    if (!match) continue;

    let location = "unknown";
    for (let offset = index + 1; offset < Math.min(lines.length, index + 20); offset += 1) {
      const locationMatch = lines[offset].match(/^\s+location: ['"]([^'"]+)['"]/);
      if (locationMatch) {
        location = normalizeLocation(locationMatch[1]);
        break;
      }
      if (/^(?:ok|not ok) \d+ - /.test(lines[offset])) break;
    }

    const key = `${location} :: ${match[1]}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }

  const summary = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...String(tap ?? "").matchAll(new RegExp(`^# ${key} (\\d+)$`, "gm"))];
    if (matches.length === 0) {
      throw new Error(`TAP summary is missing # ${key}`);
    }
    summary[key] = Number(matches.at(-1)[1]);
  }

  if (summary.fail !== [...failures.values()].reduce((sum, count) => sum + count, 0)) {
    throw new Error(
      `TAP failure summary mismatch: summary=${summary.fail}, parsed=${[
        ...failures.values(),
      ].reduce((sum, count) => sum + count, 0)}`,
    );
  }

  return { failures, summary };
}

export function assertNoTestRegressions(baselineTap, candidateTap) {
  const baseline = parseTapResult(baselineTap);
  const candidate = parseTapResult(candidateTap);

  const newFailures = [];
  for (const [key, candidateCount] of candidate.failures) {
    const baselineCount = baseline.failures.get(key) ?? 0;
    if (candidateCount > baselineCount) {
      newFailures.push(`${key} (+${candidateCount - baselineCount})`);
    }
  }

  if (newFailures.length > 0) {
    throw new Error(`Autofix introduced new test failures:\n${newFailures.join("\n")}`);
  }
  if (candidate.summary.tests < baseline.summary.tests) {
    throw new Error(
      `Autofix reduced executed tests: baseline=${baseline.summary.tests}, candidate=${candidate.summary.tests}`,
    );
  }
  if (candidate.summary.cancelled > baseline.summary.cancelled) {
    throw new Error(
      `Autofix increased cancelled tests: baseline=${baseline.summary.cancelled}, candidate=${candidate.summary.cancelled}`,
    );
  }
  if (candidate.summary.skipped > baseline.summary.skipped) {
    throw new Error(
      `Autofix increased skipped tests: baseline=${baseline.summary.skipped}, candidate=${candidate.summary.skipped}`,
    );
  }
  if (candidate.summary.todo > baseline.summary.todo) {
    throw new Error(
      `Autofix increased todo tests: baseline=${baseline.summary.todo}, candidate=${candidate.summary.todo}`,
    );
  }

  return { baseline: baseline.summary, candidate: candidate.summary };
}

async function main() {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    throw new Error("Usage: reliability-autofix-test-delta.mjs <baseline.tap> <candidate.tap>");
  }
  const [baselineTap, candidateTap] = await Promise.all([
    readFile(baselinePath, "utf8"),
    readFile(candidatePath, "utf8"),
  ]);
  const result = assertNoTestRegressions(baselineTap, candidateTap);
  console.log(
    `Autofix test delta accepted: baseline fail=${result.baseline.fail}, candidate fail=${result.candidate.fail}`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
