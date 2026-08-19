import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recovery = await readFile("src/app/keyword-engine-elon-lab/KeywordElonInterruptedRunRecovery.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const bridge = await readFile("src/app/keyword-engine-elon-lab/KeywordElonScoreFetchBridge.tsx", "utf8");

test("stale STEP 2 browser states are converted to a resumable error state", () => {
  assert.match(recovery, /INTERRUPTED_STATUSES = new Set\(\["discovering", "scoring", "title"\]\)/);
  assert.match(recovery, /stage2Status: "error"/);
  assert.match(recovery, /새로고침으로 STEP 2 실행이 중단되었습니다/);
  assert.match(recovery, /window\.location\.reload\(\)/);
});

test("STEP 3 remains visible as a locked card until STEP 2 completes", () => {
  assert.match(recovery, /STEP 3 · 잠금/);
  assert.match(recovery, /STEP 2 완료 후 통과키워드 추가발굴이 열립니다/);
  assert.match(recovery, /STEP 2 점수화 재개/);
  assert.match(recovery, /새 실험을 시작하지 마세요/);
  assert.match(layout, /KeywordElonInterruptedRunRecovery/);
  assert.ok(layout.indexOf("KeywordElonInterruptedRunRecovery") < layout.lastIndexOf("KeywordElonStep3Expansion"));
});

test("resume button reuses the existing score-bridge error recovery path", () => {
  assert.match(recovery, /findStep2Button/);
  assert.match(recovery, /button\.click\(\)/);
  assert.match(bridge, /session\.stage2Status !== "error"/);
  assert.match(bridge, /이전 후보 .*재사용/);
});
