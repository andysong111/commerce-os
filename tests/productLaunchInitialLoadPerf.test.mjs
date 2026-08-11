import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const guard = await readFile(
  new URL("../public/product-launch-tracker-app/optimized-page-fetch-guard.js", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL("../src/app/api/product-launch-tracker/optimized/route.ts", import.meta.url),
  "utf8",
);

test("목록 전용 로딩 가드가 optimized app보다 먼저 설치된다", () => {
  const guardImport = app.indexOf('await import("./optimized-page-fetch-guard.js")');
  const optimizedImport = app.indexOf('await import("./optimized-app.js")');
  assert.ok(guardImport >= 0);
  assert.ok(optimizedImport > guardImport);
});

test("목록 GET만 10초 제한과 1회 자동 재시도를 사용한다", () => {
  assert.match(guard, /const PAGE_TIMEOUT_MS = 10_000;/);
  assert.match(guard, /const PAGE_MAX_ATTEMPTS = 2;/);
  assert.match(guard, /method !== "GET"/);
  assert.match(guard, /url\.pathname === PAGE_ENDPOINT/);
  assert.match(guard, /searchParams\.get\("mode"\).*"page"/s);
});

test("콜드 캐시는 timestamp 선조회 없이 전체 상태를 한 번만 읽는다", () => {
  const coldStart = route.indexOf("if (!existing) {");
  const fullRead = route.indexOf("return loadAndCacheFullState(config, ownerId);", coldStart);
  const stampRead = route.indexOf("const stamp = await readStateStamp(config, ownerId);", coldStart);
  assert.ok(coldStart >= 0);
  assert.ok(fullRead > coldStart);
  assert.ok(stampRead > fullRead);
});
