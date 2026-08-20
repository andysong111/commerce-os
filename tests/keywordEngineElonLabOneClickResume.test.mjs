import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridge = await readFile("src/app/keyword-engine-elon-lab/KeywordElonAutoRunResumeBridge.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("one-click resume matches the same 1688 product by offerId, not full URL", () => {
  assert.match(bridge, /parse1688OfferId/);
  assert.match(bridge, /markerOfferId/);
  assert.match(bridge, /sessionOfferId/);
  assert.match(bridge, /markerOfferId === sessionOfferId/);
  assert.match(bridge, /source:\s*\{[\s\S]*url: marker\.url/);
});

test("stale running marker is re-armed after browser return", () => {
  assert.match(bridge, /marker\.status === "running"/);
  assert.match(bridge, /RUNNING_STALE_MS/);
  assert.match(bridge, /status: "armed"/);
  assert.match(bridge, /자동 재개/);
});

test("resume bridge is mounted and covered by CI", () => {
  assert.match(layout, /KeywordElonAutoRunResumeBridge/);
  assert.match(layout, /<KeywordElonAutoRunResumeBridge \/>/);
  assert.match(workflow, /KeywordElonAutoRunResumeBridge\.tsx/);
  assert.match(workflow, /keywordEngineElonLabOneClickResume\.test\.mjs/);
});
