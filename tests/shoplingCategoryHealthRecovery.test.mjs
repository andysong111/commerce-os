import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("보존된 샵플링 카테고리는 health 결과에서 재수집 없이 복구 저장한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const recovery = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-local-health-recovery.js",
      import.meta.url,
    ),
    "utf8",
  );

  const compactIndex = app.indexOf("category-local-upload-payload.js");
  const recoveryIndex = app.indexOf("category-local-health-recovery.js");
  const updateIndex = app.indexOf("category-local-update.js");
  assert.ok(compactIndex >= 0);
  assert.ok(recoveryIndex > compactIndex);
  assert.ok(updateIndex > recoveryIndex);

  assert.match(recovery, /127\.0\.0\.1:8776/);
  assert.match(recovery, /localJson\("\/health"\)/);
  assert.match(recovery, /resultReady !== true/);
  assert.match(recovery, /health\.requestId/);
  assert.match(recovery, /category-update\/result\?requestId=/);
  assert.match(recovery, /shopling-categories\/local-result/);
  assert.match(recovery, /targetAddressSpace: "loopback"/);
  assert.match(recovery, /health-recovered/);
  assert.match(recovery, /재수집 없이/);
  assert.doesNotMatch(recovery, /category-update\/start/);
});
