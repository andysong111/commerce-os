import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/app/api/product-launch-tracker/migrations/shopling-location-code-backfill-normalized-20260814/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("normalized-only B 위치코드 백필은 canonical JSON을 읽지 않는다", () => {
  assert.match(source, /readProductLaunchNormalizedWorkspace/);
  assert.match(source, /product_launch_items/);
  assert.match(source, /product_launch_options/);
  assert.doesNotMatch(source, /select: "state_payload/);
  assert.match(source, /source_state_updated_at/);
});

test("normalized-only B 위치코드 백필은 승인 계약과 canonical 조건부 저장을 유지한다", () => {
  assert.match(source, /EXPECTED_MAPPING_ITEMS = 222/);
  assert.match(source, /EXPECTED_MAPPING_OPTIONS = 393/);
  assert.match(source, /EXPECTED_TRACKER_ITEMS = 346/);
  assert.match(source, /EXPECTED_TRACKER_OPTIONS = 740/);
  assert.match(source, /56c15e73f74b0051dd2b49d4051f0116651b697c30acd671734897d01ea5bd3c/);
  assert.match(source, /updated_at: `eq\.\$\{previousUpdatedAt\}`/);
  assert.match(source, /syncProductLaunchNormalizedChangedItems/);
});
