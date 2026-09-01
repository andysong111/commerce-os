import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [registry, workspace] = await Promise.all([
  readFile("src/lib/extendedModuleRegistry.ts", "utf8"),
  readFile("src/lib/opsWorkspace.ts", "utf8"),
]);

test("confirmed-cost price review is reachable from Ops Center price workspace", () => {
  assert.match(registry, /id: "internal-china-cost-price-review"/);
  assert.match(registry, /route: "\/china-order-manager\/price-review"/);
  assert.match(registry, /가격조정안 승인은 정책·대상 확정 단계/);
  assert.match(registry, /실제 Shopling 가격 쓰기는 승인 후 나타나는 적용 버튼/);
  assert.match(workspace, /"internal-china-cost-price-review"/);
  assert.match(workspace, /"확정원가"/);
  assert.match(workspace, /"상품그룹"/);
});
