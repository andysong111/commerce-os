import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Product Master Shopling cron auto-starts only the initial read-only diagnostic", async () => {
  const [route, worker, vercel] = await Promise.all([
    read("src/app/api/cron/product-master-shopling-diagnostic/route.ts"),
    read("src/lib/productMasterShoplingDiagnostic.ts"),
    read("vercel.json"),
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

  assert.match(worker, /new ShoplingReadClient\(config\)\.read\("products", nextRange\)/);
  assert.match(worker, /planning\.contentFingerprint !== request\.planningContentFingerprint/);
  assert.match(worker, /PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REPORT/);
  assert.doesNotMatch(worker, /method:\s*"(?:PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(worker, /shopling-price|price-modify|1688/i);

  const config = JSON.parse(vercel);
  assert.equal(
    config.crons.filter(
      (entry) => entry.path === "/api/cron/product-master-shopling-diagnostic",
    ).length,
    1,
  );
});
