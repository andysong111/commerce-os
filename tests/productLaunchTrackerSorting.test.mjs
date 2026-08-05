import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyStageStatus,
  createLaunchItem,
  hydrateLaunchItem,
  sortLaunchItems,
} from "../public/product-launch-tracker-app/lib/tracker-core.mjs";

const indexSource = await readFile(
  new URL("../public/product-launch-tracker-app/index.html", import.meta.url),
  "utf8",
);
const optimizedSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/optimized-app.js",
    import.meta.url,
  ),
  "utf8",
);
const entrySource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);

test("신규 상품 진행관리의 업무 헤더 14개가 서버 정렬 버튼을 제공한다", () => {
  assert.equal(
    [...indexSource.matchAll(/<th class="sort-header" data-sort-key="/g)].length,
    14,
  );
  assert.match(
    optimizedSource,
    /elements\.tableHead\?\.addEventListener\("click", handleSortClick\)/,
  );
  assert.match(optimizedSource, /header\.setAttribute\([\s\S]*"aria-sort"/);
  assert.match(optimizedSource, /sortKey/);
  assert.match(optimizedSource, /sortDirection/);
});

test("바코드는 모델번호 왼쪽에서 직접 입력하고 상품 1건만 저장한다", () => {
  assert.match(
    indexSource,
    /data-sort-key="barcode"[\s\S]*data-sort-key="modelNumber"/,
  );
  assert.match(optimizedSource, /class="barcode-input optimized-inline-input"/);
  assert.match(
    optimizedSource,
    /input\.matches\("\.barcode-input"\)[\s\S]*operation: "patch_item"[\s\S]*patch: \{ barcode: normalized \}/,
  );
  assert.equal(
    hydrateLaunchItem(createLaunchItem({ modelNumber: "AAA413" }, () => "one"))
      .barcode,
    "",
  );
});

test("진행관리 앱은 페이지 조회와 상품 단위 PATCH API로 실행된다", () => {
  assert.match(entrySource, /optimized-app\.js/);
  assert.doesNotMatch(entrySource, /bootstrap\.js/);
  assert.match(
    optimizedSource,
    /const OPTIMIZED_API = "\/api\/product-launch-tracker\/optimized"/,
  );
  assert.match(optimizedSource, /pageSize: String\(state\.pageSize\)/);
  assert.match(optimizedSource, /method: "PATCH"/);
  assert.match(optimizedSource, /operation: "patch_item"/);
  assert.doesNotMatch(optimizedSource, /Storage\.prototype\.setItem/);
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
