import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auto = await readFile("src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx", "utf8");
const bridge = await readFile("src/app/keyword-engine-elon-lab/KeywordElonAutoRunResumeBridge.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const collector = await readFile("public/keyword-lab-collector/content-1688.js", "utf8");

test("one-click regression is repaired when 1688 mutates query params on return", () => {
  assert.match(auto, /compactKeywordElonKey\(session\.source\.url\) === compactKeywordElonKey\(marker\.url\)/);
  assert.match(collector, /sourceUrlWithoutLabParams/);
  assert.match(bridge, /parse1688OfferId\(markerUrl\)/);
  assert.match(bridge, /session\.source\.offerId \|\| parse1688OfferId\(session\.source\.url\)/);
  assert.match(bridge, /markerOfferId === sessionOfferId/);
  assert.match(bridge, /url: marker\.url/);
  assert.match(bridge, /keyword-elon-session-updated/);
});

test("offer-id resume bridge is mounted before the one-click runner", () => {
  assert.match(layout, /KeywordElonAutoRunResumeBridge/);
  assert.match(layout, /<KeywordElonAutoRunResumeBridge \/>/);
  assert.ok(layout.indexOf("<KeywordElonAutoRunResumeBridge />") < layout.indexOf("<KeywordElonAutoRunToStep4 />"));
});
