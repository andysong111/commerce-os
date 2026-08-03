import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const knowledge = await readFile(
  new URL("../src/lib/opsAiKnowledge.ts", import.meta.url),
  "utf8",
);
const registry = await readFile(
  new URL("../src/lib/extendedModuleRegistry.ts", import.meta.url),
  "utf8",
);

test("OPS AI explains that purchase recommendations no longer decide discontinuation", () => {
  assert.match(knowledge, /발주 추천은 같은 바코드/);
  assert.match(knowledge, /단종후보와 상품등급 판단은 상품등급·가격조정에서 담당/);
  assert.match(knowledge, /그림자 운영 중에는 -3·-4 등급도 발주를 실제 차단하지 않는다/);
});

test("OPS AI explains grades, automatic seasonality and execution boundaries", () => {
  assert.match(knowledge, /숨은 시즌을 자동 판별해 \+6~-4 등급/);
  assert.match(knowledge, /-1·-2는 가격을 유지하며 관찰/);
  assert.match(knowledge, /초기 그림자 운영에서는 실제 가격변경과 재발주 차단을 하지 않는다/);
  assert.match(registry, /title: "상품등급·가격조정"/);
  assert.match(registry, /title: "발주 추천"/);
});
