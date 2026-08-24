import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("autofix generation keeps enough server time and output budget without exceeding route limits", async () => {
  const openai = await source("src/lib/reliability/reliabilityAutofixOpenAi.ts");
  const route = await source("src/app/api/integrations/reliability/autofix/route.ts");
  const worker = await source("scripts/reliability-autofix-worker.mjs");

  assert.match(openai, /AUTOFIX_TIMEOUT_MS = 100_000/);
  assert.match(openai, /AUTOFIX_OUTPUT_TOKENS = 9_000/);
  assert.match(route, /maxDuration = 120/);
  assert.match(worker, /AbortSignal\.timeout\(115_000\)/);
});
