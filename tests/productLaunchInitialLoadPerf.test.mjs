import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL("../src/app/api/product-launch-tracker/optimized/route.ts", import.meta.url),
  "utf8",
);

test("초기 목록 로딩은 요청을 강제 중단하거나 전역 fetch를 교체하지 않는다", () => {
  assert.doesNotMatch(app, /optimized-page-fetch-guard\.js/);
  assert.doesNotMatch(app, /window\.fetch\s*=/);
  assert.match(app, /목록 응답 지연 · 서버 응답을 기다리는 중/);
  assert.match(app, /await import\("\.\/optimized-app\.js"\)/);
});

test("콜드 캐시는 timestamp 선조회 없이 전체 상태를 한 번만 읽는다", () => {
  const coldStart = route.indexOf("if (!existing) {");
  const fullRead = route.indexOf("return loadAndCacheFullState(config, ownerId);", coldStart);
  const stampRead = route.indexOf("const stamp = await readStateStamp(config, ownerId);", coldStart);
  assert.ok(coldStart >= 0);
  assert.ok(fullRead > coldStart);
  assert.ok(stampRead > fullRead);
});
