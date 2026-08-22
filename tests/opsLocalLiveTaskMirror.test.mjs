import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mirror = await readFile(
  "src/components/OpsLocalLiveTaskMirror.tsx",
  "utf8",
);
const shell = await readFile("src/components/AppShell.tsx", "utf8");

test("OPS AppShell mounts a global browser live-task mirror", () => {
  assert.match(shell, /OpsLocalLiveTaskMirror/);
  assert.match(shell, /<OpsLocalLiveTaskMirror \/>/);
  assert.match(mirror, /OPS CENTER · LIVE TASK/);
  assert.match(mirror, /작업 화면 열기/);
});

test("live-task mirror reads keyword scoring and primary-link audit local state", () => {
  assert.match(mirror, /keywordEngineElonLab\.v2\.session/);
  assert.match(mirror, /keywordEngineElonLab\.autoRunToStep4\.v1/);
  assert.match(mirror, /keywordElon\.scoreBridge\./);
  assert.match(mirror, /commerceOs\.chinaLinkAudit\.run\.v1/);
  assert.match(mirror, /AI 점수화/);
  assert.match(mirror, /고정링크 전체재검사/);
});

test("live-task mirror stays low-load and does not duplicate Keyword Lab's local scoring card", () => {
  assert.match(mirror, /const LOCAL_SYNC_MS = 1_000/);
  assert.doesNotMatch(mirror, /fetch\(/);
  assert.doesNotMatch(mirror, /MutationObserver/);
  assert.match(mirror, /window\.addEventListener\("storage"/);
  assert.match(mirror, /keyword-elon-session-updated/);
  assert.match(mirror, /pathname\.startsWith\("\/keyword-engine-elon-lab"\)/);
});
