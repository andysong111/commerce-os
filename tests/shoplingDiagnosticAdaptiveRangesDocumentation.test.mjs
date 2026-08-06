import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const document = await readFile(
  "docs/shopling-diagnostic-adaptive-ranges.md",
  "utf8",
);

test("adaptive Shopling diagnostic recovery is documented as bounded and read-only", () => {
  assert.match(document, /최근 24개 달/);
  assert.match(document, /최대 30일/);
  assert.match(document, /7일 단위/);
  assert.match(document, /무한 반복을 방지/);
  assert.match(document, /인증키 XML과 긴 토큰 형태는 마스킹/);
  assert.match(document, /가격 변경/);
  assert.match(document, /1688 주문/);
});
