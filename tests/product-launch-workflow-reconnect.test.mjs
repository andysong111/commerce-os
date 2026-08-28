import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gateUrl = new URL(
  "../public/product-launch-tracker-app/workflow-ui-gate.js",
  import.meta.url,
);
const pageUrl = new URL(
  "../src/app/product-launch-tracker/page.tsx",
  import.meta.url,
);

test("상품출시 Workflow gate는 normalized fast read를 사용하고 짧게 재시도한다", async () => {
  const source = await readFile(gateUrl, "utf8");

  assert.match(
    source,
    /const WORKFLOW_API = "\/api\/product-launch-tracker\/normalized-optimized";/,
  );
  assert.match(source, /const PROBE_TIMEOUT_MS = 8_000;/);
  assert.match(source, /const IDLE_RETRY_MS = 5_000;/);
  assert.doesNotMatch(source, /const IDLE_RETRY_MS = 30_000;/);
});

test("상품출시 페이지 asset version은 Workflow reconnect 수정본을 구분한다", async () => {
  const source = await readFile(pageUrl, "utf8");
  assert.match(source, /workflow-reconnect-v1/);
});
