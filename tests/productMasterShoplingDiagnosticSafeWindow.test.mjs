import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL(
    "../src/app/api/cron/product-master-shopling-diagnostic/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Shopling catalog diagnostic defaults to the latest 24 calendar months", () => {
  assert.match(route, /now\.getUTCMonth\(\) - 23/);
  assert.match(route, /Date\.UTC\(now\.getUTCFullYear\(\), now\.getUTCMonth\(\) - 23, 1\)/);
  assert.match(route, /SHOPLING_CATALOG_START_DATE/);
  assert.doesNotMatch(route, /process\.env\.SHOPLING_CATALOG_START_DATE\s*=\s*"2000-01-01"/);
});

test("the one-minute worker automatically replaces only the known legacy failed request", () => {
  assert.match(route, /LEGACY_FAILED_RANGE = "2000-01-01:2000-12-30"/);
  assert.match(route, /current\.state === "FAILED"/);
  assert.match(route, /current\.message\.includes\(LEGACY_FAILED_RANGE\)/);
  assert.match(route, /current\.state === "IDLE" \|\| legacyFailed/);
  assert.match(route, /createProductMasterShoplingDiagnosticRequest/);
});

test("safe-window recovery remains read-only and cron-authenticated", () => {
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /authorization === `Bearer \$\{expected\}`/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /shopling-price|price-modify|1688|inventory.*write/i);
});
