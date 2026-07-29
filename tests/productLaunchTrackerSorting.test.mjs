import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyStageStatus,
  createLaunchItem,
  sortLaunchItems,
} from "../public/product-launch-tracker-app/lib/tracker-core.mjs";

const indexSource = await readFile(
  new URL("../public/product-launch-tracker-app/index.html", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);

test("신규 상품 진행관리의 업무 헤더 13개가 오름차순·내림차순 버튼을 제공한다", () => {
  assert.equal(
    [...indexSource.matchAll(/<th class="sort-header" data-sort-key="/g)].length,
    13,
  );
  assert.match(
    appSource,
    /elements\.tableHead\.addEventListener\("click", handleSortClick\)/,
  );
  assert.match(appSource, /header\.setAttribute\(\s*"aria-sort"/);
});

test("상태 헤더 정렬은 미시작·진행 중·보류·완료·제외 업무 순서를 따른다", () => {
  const statuses = ["완료", "미시작", "제외", "보류", "진행 중"];
  const items = statuses.map((status, index) =>
    applyStageStatus(
      createLaunchItem({ modelNumber: `AAA${index + 1}` }, () => status),
      "detailPage",
      status,
    ),
  );

  assert.deepEqual(
    sortLaunchItems(items, { key: "detailPage", direction: "asc" }).map(
      (item) => item.stages.detailPage.status,
    ),
    ["미시작", "진행 중", "보류", "완료", "제외"],
  );
  assert.deepEqual(
    sortLaunchItems(items, { key: "detailPage", direction: "desc" }).map(
      (item) => item.stages.detailPage.status,
    ),
    ["제외", "완료", "보류", "진행 중", "미시작"],
  );
});
