import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("미등록 상태의 이전 조립기 RUN은 v6으로 자동 재생성하고 등록 중·완료 RUN은 건드리지 않는다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bridge = await source(
    "src/app/seo-bulk-cloud/SeoBulkLongTitleV6UpgradeBridge.tsx",
  );

  assert.match(page, /SeoBulkLongTitleV6UpgradeBridge/);
  assert.ok(
    page.indexOf("<SeoBulkLongTitleV6UpgradeBridge />") <
      page.indexOf("<SeoBulkRunCloudClient />"),
  );
  assert.match(
    bridge,
    /CURRENT_SEO_FINAL_SOURCE = "seo-bulk-cloud-long-title-priority-v6"/,
  );
  assert.match(bridge, /ACTIVE_SHOPLING_STATUSES/);
  for (const status of ["submitting", "queued", "running", "success"]) {
    assert.match(bridge, new RegExp(`"${status}"`));
  }
  assert.match(bridge, /source === CURRENT_SEO_FINAL_SOURCE/);
  assert.match(bridge, /generationStatus: "idle"/);
  assert.match(bridge, /seoFinal: null/);
  assert.match(bridge, /shoplingStatus === "failed" \? "idle" : shoplingStatus/);
  assert.match(bridge, /reason: "long_title_priority_v6"/);
  assert.match(bridge, /window\.localStorage\.setItem\(BATCH_STORAGE_KEY, serialized\)/);
  assert.match(bridge, /new StorageEvent\("storage"/);
});
