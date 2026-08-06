import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adaptive Shopling diagnostic recovery branch is ready for CI", async () => {
  assert.equal(
    (await readFile("docs/.shopling-diagnostic-adaptive-ready", "utf8")).trim(),
    "ready",
  );
});
