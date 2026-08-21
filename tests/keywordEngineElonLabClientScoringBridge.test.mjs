import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridge = await readFile("src/app/keyword-engine-elon-lab/KeywordElonScoreFetchBridge.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");

test("Keyword Lab scores candidates through browser-side 12-item requests", () => {
  assert.match(bridge, /SCORE_CLIENT_CHUNK_SIZE = 12/);
  assert.match(bridge, /SCORE_MIN_ADAPTIVE_CHUNK_SIZE = 3/);
  assert.match(bridge, /action !== "score_keywords"/);
  assert.match(bridge, /for \(let index = 0; index < chunks\.length; index \+= 1\)/);
  assert.match(bridge, /filterDiscovery/);
  assert.match(bridge, /nativeFetch\(input/);
  assert.doesNotMatch(bridge, /Promise\.all\(chunks/);
});

test("Keyword Lab adaptively splits slow scoring chunks", () => {
  assert.match(bridge, /shouldAdaptiveSplit/);
  assert.match(bridge, /AI_SCORE_TIMEOUT/);
  assert.match(bridge, /AI_SCORE_INCOMPLETE/);
  assert.match(bridge, /FUNCTION_INVOCATION_TIMEOUT/);
  assert.match(bridge, /const middle = Math\.ceil\(chunk\.length \/ 2\)/);
  assert.match(bridge, /scoreAdaptive\(left/);
  assert.match(bridge, /scoreAdaptive\(right/);
  assert.match(bridge, /12개 묶음이 느리면 6개 → 3개로 자동 축소/);
});

test("Keyword Lab persists completed scoring chunks and survives browser quota exhaustion", () => {
  assert.match(bridge, /SCORE_CACHE_PREFIX = "keywordElon\.scoreBridge\.v3\.marketRecall"/);
  assert.match(bridge, /SCORE_CACHE_FAMILY_PREFIX = "keywordElon\.scoreBridge\."/);
  assert.match(bridge, /marketRecallVersion: 4/);
  assert.match(bridge, /window\.localStorage\.setItem\(key/);
  assert.match(bridge, /isQuotaExceededError/);
  assert.match(bridge, /pruneScoreCacheStorage/);
  assert.match(bridge, /cachePersistenceAvailable/);
  assert.match(bridge, /캐시 저장 없이 현재 실행을 메모리에서 계속/);
  assert.match(bridge, /window\.localStorage\.removeItem\(key\)/);
  assert.match(bridge, /sessionDiscoveryForResume/);
  assert.match(bridge, /stage2Status !== "error"/);
  assert.match(bridge, /이전 후보 .*SearchAd 재호출 없이 점수화를 재개/);
  assert.match(bridge, /STEP 2를 다시 누르면 완료된 묶음은 건너뛰고 실패 지점부터 재개/);
});

test("Keyword Lab enriches monthly demand after semantic safety scoring", () => {
  assert.match(bridge, /action: "enrich_demand"/);
  assert.match(bridge, /안전Gate 통과 후보의 월검색 미측정 값을 SearchAd로 보강/);
  assert.match(bridge, /demandEnriched: true/);
  assert.match(bridge, /월검색 보강/);
});

test("route layout always mounts the scoring bridge", () => {
  assert.match(layout, /KeywordElonScoreFetchBridge/);
  assert.match(layout, /<KeywordElonScoreFetchBridge \/>/);
});
