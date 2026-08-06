import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, service] = await Promise.all([
  readFile(
    new URL(
      "../src/app/api/cron/product-master-shopling-diagnostic/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../src/lib/productMasterShoplingDiagnostic.ts", import.meta.url),
    "utf8",
  ),
]);

test("Shopling catalog diagnostic retains the latest 24 calendar months", () => {
  assert.match(service, /const DEFAULT_CATALOG_MONTHS = 24/);
  assert.match(
    service,
    /now\.getUTCMonth\(\) - \(DEFAULT_CATALOG_MONTHS - 1\)/,
  );
  assert.match(service, /SHOPLING_CATALOG_START_DATE/);
  assert.doesNotMatch(service, /DEFAULT_CATALOG_START_DATE\s*=\s*"2000-01-01"/);
});

test("new diagnostics start with bounded 30-day ranges", () => {
  assert.match(
    service,
    /PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS = 30/,
  );
  assert.match(service, /SHOPLING_CATALOG_CHUNK_DAYS/);
  assert.match(service, /MAX_CONFIGURED_CHUNK_DAYS = 31/);
  assert.match(
    service,
    /splitShoplingDateRange\(start, end, chunkDays\)/,
  );
  assert.match(service, /chunkDays,/);
  assert.match(service, /supersedesRequestId/);
});

test("the worker falls back from long ranges to 30 days, 7 days, and finally two days", () => {
  assert.match(
    route,
    /PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS = 2/,
  );
  assert.match(route, /fewer than 500 immutable chunk rows/);
  assert.match(
    route,
    /state\.chunkDays > PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS/,
  );
  assert.match(
    route,
    /state\.chunkDays > PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS/,
  );
  assert.match(
    route,
    /state\.chunkDays > PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS/,
  );
  assert.match(
    route,
    /state\.chunkDays <= PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS/,
  );
  assert.match(
    route,
    /fallbackChunkDays \?\? PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS/,
  );
  assert.match(route, /supersedesRequestId: current\.requestId/);
  assert.match(route, /최대 30일 단위/);
  assert.match(route, /최대 7일 단위/);
  assert.match(route, /최대 2일 단위로 최종 안전 재접수/);
});

test("a failed two-day run stops instead of creating an infinite retry loop", () => {
  const recoveryFunction = route.slice(
    route.indexOf("function recoveryChunkDays"),
    route.indexOf("export async function GET"),
  );
  assert.match(recoveryFunction, /if \(state\.state !== "FAILED"\) return null/);
  assert.match(
    recoveryFunction,
    /state\.chunkDays > PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS/,
  );
  assert.match(recoveryFunction, /return null/);
  assert.doesNotMatch(recoveryFunction, /while|setInterval|setTimeout/);
});

test("adaptive recovery remains read-only and cron-authenticated", () => {
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /authorization === `Bearer \$\{expected\}`/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/);
  for (const source of [route, service]) {
    assert.doesNotMatch(source, /shopling-price|price-modify|1688|inventory.*write/i);
  }
});
