import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridge = await readFile("src/app/keyword-engine-elon-lab/KeywordElonScoreFetchBridge.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");

test("Keyword Lab scores 500 candidates through browser-side 20-item requests", () => {
  assert.match(bridge, /SCORE_CLIENT_CHUNK_SIZE = 20/);
  assert.match(bridge, /action !== "score_keywords"/);
  assert.match(bridge, /for \(let index = 0; index < chunks\.length; index \+= 1\)/);
  assert.match(bridge, /filterDiscovery/);
  assert.match(bridge, /nativeFetch\(input/);
  assert.doesNotMatch(bridge, /Promise\.all\(chunks/);
});

test("Keyword Lab persists completed scoring chunks and resumes without rediscovering", () => {
  assert.match(bridge, /SCORE_CACHE_PREFIX = "keywordElon\.scoreBridge\.v1"/);
  assert.match(bridge, /window\.localStorage\.setItem\(key/);
  assert.match(bridge, /sessionDiscoveryForResume/);
  assert.match(bridge, /stage2Status !== "error"/);
  assert.match(bridge, /이전 후보 .*SearchAd 재호출 없이 점수화를 재개/);
  assert.match(bridge, /STEP 2를 다시 누르면 완료된 묶음은 건너뛰고 실패 지점부터 재개/);
});

test("route layout always mounts the scoring bridge", () => {
  assert.match(layout, /KeywordElonScoreFetchBridge/);
  assert.match(layout, /<KeywordElonScoreFetchBridge \/>/);
});
