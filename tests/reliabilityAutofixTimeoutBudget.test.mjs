import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("Reliability Autofix 생성 요청은 3회 보정 루프가 prepare 제한 안에서 끝나는 계층형 timeout 예산을 유지한다", async () => {
  const [worker, route, openAi, workflow] = await Promise.all([
    source("scripts/reliability-autofix-worker.mjs"),
    source("src/app/api/integrations/reliability/autofix/route.ts"),
    source("src/lib/reliability/reliabilityAutofixOpenAi.ts"),
    source(".github/workflows/reliability-safe-autofix.yml"),
  ]);

  assert.match(worker, /const MAX_GENERATION_REVISIONS = 2;/);
  assert.match(worker, /const AUTOFIX_API_TIMEOUT_MS = 165_000;/);
  assert.match(worker, /AbortSignal\.timeout\(AUTOFIX_API_TIMEOUT_MS\)/);
  assert.match(openAi, /const AUTOFIX_TIMEOUT_MS = 145_000;/);
  assert.match(openAi, /AbortSignal\.timeout\(AUTOFIX_TIMEOUT_MS\)/);
  assert.match(route, /export const maxDuration = 180;/);
  assert.match(workflow, /prepare:\s*[\s\S]*?timeout-minutes: 10/);
  assert.ok(145_000 < 165_000, "OpenAI timeout must expire before the caller timeout");
  assert.ok(165_000 < 180_000, "caller timeout must expire before the Vercel route limit");
  assert.ok(165_000 * 3 < 10 * 60_000, "three bounded generation calls must fit the prepare job");
});
