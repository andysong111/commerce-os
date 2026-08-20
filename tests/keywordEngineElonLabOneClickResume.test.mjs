import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridge = await readFile("src/app/keyword-engine-elon-lab/KeywordElonAutoRunResumeBridge.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("one-click resume matches same 1688 offer and can re-arm interrupted runs", () => {
  assert.match(bridge, /parse1688OfferId/);
  assert.match(bridge, /markerOfferId === sessionOfferId/);
  assert.match(bridge, /marker\.status === "running"/);
  assert.match(bridge, /status: "armed"/);
});

test("resume bridge is mounted and covered by CI", () => {
  assert.match(layout, /KeywordElonAutoRunResumeBridge/);
  assert.match(layout, /<KeywordElonAutoRunResumeBridge \/>/);
  assert.match(workflow, /KeywordElonAutoRunResumeBridge\.tsx/);
  assert.match(workflow, /keywordEngineElonLabOneClickResume\.test\.mjs/);
});
