import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("autofix prompt requires repository-compatible regression tests", async () => {
  const source = await readFile(
    "src/lib/reliability/reliabilityAutofixPolicy.ts",
    "utf8",
  );

  assert.match(source, /reuse_repository_test_harness:\s*true/);
  assert.match(source, /package\.json의 npm test 명령/);
  assert.match(source, /기존 테스트의 transpile\/load 패턴을 재사용/);
  assert.match(source, /@\/ 경로 별칭/);
});
