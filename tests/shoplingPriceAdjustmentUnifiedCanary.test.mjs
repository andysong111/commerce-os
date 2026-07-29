import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("single base and option canary boxes are replaced by one automatic panel", async () => {
  const [page, panel] = await Promise.all([
    readFile(new URL("../src/app/shopling-price-adjustment-runner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-adjustment/ShoplingPriceAdjustmentUnifiedCanaryPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ShoplingPriceAdjustmentUnifiedCanaryPanel/);
  assert.doesNotMatch(page, /ShoplingPriceAdjustmentOptionCanaryPanel/);
  assert.match(page, /section:nth-of-type\(3\)/);

  assert.match(panel, /단일 상품 가격 변경 카나리/);
  assert.match(panel, /기본가격 \+ 옵션 추가금/);
  assert.match(panel, /기본가격/);
  assert.match(panel, /sameNumberArray/);
  assert.match(panel, /option-canary\/run/);
  assert.match(panel, /canary\/run/);
  assert.match(panel, /option-canary\/result/);
  assert.match(panel, /canary\/result/);
  assert.match(panel, /옵션 추가금이 있으면 판매가와 같은 조정률로 자동 변경/);
  assert.match(panel, /이 1개 실제 가격 변경 테스트/);
});
