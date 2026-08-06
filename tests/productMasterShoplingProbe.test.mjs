import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, route, page, control] = await Promise.all([
  readFile("src/lib/productMasterShoplingProbe.ts", "utf8"),
  readFile(
    "src/app/api/product-master/shopling-diagnostic/probe/route.ts",
    "utf8",
  ),
  readFile(
    "src/app/product-master/shopling-diagnostic/probe/page.tsx",
    "utf8",
  ),
  readFile(
    "src/app/product-master/shopling-diagnostic/probe/ProbeControl.tsx",
    "utf8",
  ),
]);

test("probe reads only one Shopling product date and reuses the production TLS transport", () => {
  assert.match(service, /buildShoplingReadRequestXml/);
  assert.match(service, /parseShoplingReadResponse/);
  assert.match(service, /postShoplingXml/);
  assert.match(service, /start: probeDate, end: probeDate/);
  assert.match(service, /timeoutMs: 30_000/);
  assert.match(service, /commerce-os-ops-center-shopling-probe\/1\.0/);
});

test("probe classifies bounded safe connection evidence without retaining rows", () => {
  for (const category of [
    "CONFIGURATION",
    "TIMEOUT",
    "DNS",
    "TLS",
    "NETWORK",
    "HTTP",
    "SHOPLING_RESPONSE",
    "PARSE",
    "UNKNOWN",
  ]) {
    assert.match(service, new RegExp(`"${category}"`));
  }
  assert.match(service, /MAX_SAFE_MESSAGE_LENGTH = 500/);
  assert.match(service, /replaceAll\(secret, "\[REDACTED\]"\)/);
  assert.match(service, /Bearer \[REDACTED\]/);
  assert.match(service, /responseBytes/);
  assert.match(service, /rowCount/);
  assert.match(service, /managedBarcodeCount/);
  assert.doesNotMatch(service, /result_snapshot:[\s\S]*body,/);
  assert.doesNotMatch(service, /result_snapshot:[\s\S]*rows,/);
});

test("probe stores only diagnostic evidence and never performs a business write", () => {
  assert.match(service, /PRODUCT_MASTER_SHOPLING_PROBE/);
  assert.match(service, /commerce_operation_runs/);
  assert.match(service, /sourceWritesEnabled: false/);
  assert.match(service, /resource: "products"/);
  assert.match(service, /rangeDays: 1/);
  assert.doesNotMatch(
    service,
    /shopling-price|price-modify|1688|inventory_movements|order.*submit|receipt.*confirm/i,
  );
});

test("operator API requires same-origin and exposes only GET status and explicit POST probe", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /String\(body\?\.action \?\? ""\) !== "probe"/);
  assert.match(route, /runProductMasterShoplingProbe/);
  assert.doesNotMatch(route, /export async function (?:PUT|PATCH|DELETE)/);
});

test("probe page clearly keeps Product Master and Shopling writes disabled", () => {
  assert.match(page, /진단 전용 · 운영 데이터 미변경/);
  assert.match(page, /원본 응답행/);
  assert.match(page, /API 인증키/);
  assert.match(control, /실제 쓰기 상태: 차단/);
  assert.match(control, /상품·옵션·가격·재고·발주 값은 변경하지 않습니다/);
  assert.match(control, /하루 범위 연결 확인/);
});
