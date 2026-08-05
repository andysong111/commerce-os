import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile("src/app/product-decision-agent/page.tsx", "utf8");
const integration = await readFile(
  "src/lib/integrations/productDecisionAgent.ts",
  "utf8",
);

test("internal product decision page is server-rendered and read-only", () => {
  assert.match(page, /loadProductDecisionSnapshot/);
  assert.match(page, /Ops Center 내부 조회 전환 완료/);
  assert.match(page, /승인·중국 주문 전송·실제 주문 기능은 모두 차단/);
  assert.doesNotMatch(page, /method: "POST"/);
  assert.doesNotMatch(page, /shopling\/refresh/);
});

test("product decision integration reads the legacy dashboard without exposing writes", () => {
  assert.match(integration, /\/api\/sales-dashboard/);
  assert.match(integration, /cache: "no-store"/);
  assert.match(integration, /AbortSignal\.timeout\(25_000\)/);
  assert.match(integration, /writesEnabled: false/);
  assert.doesNotMatch(integration, /method: "POST"/);
});
