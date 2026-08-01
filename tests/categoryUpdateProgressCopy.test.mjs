import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("카테고리 업데이트 진행 UI는 최신화 용어를 노출하지 않는다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-update-progress.js",
      import.meta.url,
    ),
    "utf8",
  );
  const visibleCopy = source
    .split("\n")
    .filter((line) => !line.includes("replaceAll(\"최신화\""))
    .join("\n");
  assert.doesNotMatch(visibleCopy, /샵플링 카테고리 최신화/);
  assert.match(source, /샵플링 카테고리 업데이트 완료/);
  assert.match(source, /경과 \$\{minutes\}분/);
  assert.match(source, /백그라운드로 보기/);
});
