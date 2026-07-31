import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const createRoute = await readFile(
  new URL(
    "../src/app/api/integrations/price-adjustment/jobs/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const statusRoute = await readFile(
  new URL(
    "../src/app/api/integrations/price-adjustment/jobs/[jobId]/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const authSource = await readFile(
  new URL("../src/lib/priceAdjustmentIntegrationAuth.ts", import.meta.url),
  "utf8",
);
const moduleRegistry = await readFile(
  new URL("../src/lib/extendedModuleRegistry.ts", import.meta.url),
  "utf8",
);

test("가격조정 엔진 요청은 기존 안전 Bulk 오케스트레이터를 재사용한다", () => {
  assert.match(createRoute, /create_shopling_price_adjustment_bulk_job/);
  assert.match(createRoute, /start_shopling_price_adjustment_bulk_job/);
  assert.match(createRoute, /advanceShoplingPriceAdjustmentBulkJob/);
  assert.match(createRoute, /PRICE_ADJUSTMENT_ACTIVE_JOB_EXISTS/);
  assert.doesNotMatch(createRoute, /prod_each_mall_modify_api/);
});

test("상태 조회는 동일 소유자의 작업만 한 단계씩 안전 진행한다", () => {
  assert.match(statusRoute, /advanceShoplingPriceAdjustmentBulkJob/);
  assert.match(statusRoute, /\.eq\("owner_id", auth\.ownerId\)/);
  assert.match(statusRoute, /dispatch_uncertain/);
  assert.match(statusRoute, /lastError/);
});

test("서비스 인증은 별도 Bearer secret과 timing-safe 비교를 사용한다", () => {
  assert.match(authSource, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.match(authSource, /timingSafeEqual/);
  assert.match(authSource, /PRICE_ADJUSTMENT_AUTOMATION_OWNER_ID/);
});

test("Ops Center에는 인하 수동 선택 기능카드가 노출된다", () => {
  assert.match(moduleRegistry, /입고원가·판매추이 가격조정/);
  assert.match(moduleRegistry, /인하는 수동 선택/);
  assert.match(moduleRegistry, /priceAdjustmentEngineModule/);
});
