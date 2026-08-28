import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Product Master Shopling diagnostic remains read-only behind the adaptive dispatcher", async () => {
  const [route, worker, scheduler] = await Promise.all([
    read("src/app/api/cron/product-master-shopling-diagnostic/route.ts"),
    read("src/lib/productMasterShoplingDiagnostic.ts"),
    read("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql"),
  ]);

  assert.match(route, /export async function GET/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /authorization === `Bearer \$\{expected\}`/);
  assert.match(route, /productMasterShoplingDiagnosticConfigured/);
  assert.match(route, /loadProductMasterShoplingDiagnosticStatus/);
  assert.match(route, /current\.state === "IDLE"/);
  assert.match(route, /createProductMasterShoplingDiagnosticRequest/);
  assert.match(route, /state: "QUEUED"/);
  assert.match(route, /runProductMasterShoplingDiagnosticStep/);
  assert.doesNotMatch(route, /setInterval|setTimeout/);

  assert.match(
    worker,
    /new ShoplingReadClient\(config\)\.read\(\s*"products",\s*nextRange,?\s*\)/,
  );
  assert.match(worker, /planning\.contentFingerprint !== request\.planningContentFingerprint/);
  assert.match(worker, /PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REPORT/);
  assert.doesNotMatch(worker, /method:\s*"(?:PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(worker, /shopling-price|price-modify|1688/i);

  assert.match(
    scheduler,
    /'product-master-shopling-diagnostic', '\/api\/cron\/product-master-shopling-diagnostic', 'diagnostic', 220, true, 21600, 1800, 43200/,
  );
});
