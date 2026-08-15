import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [labFile, moduleFile, registryFile, pageFile, routeFile, shoplingFile] = await Promise.all([
  readFile("src/lib/keywordEngineElonLab.ts", "utf8"),
  readFile("src/lib/keywordEngineElonLabModule.ts", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8"),
  readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8"),
  readFile("src/lib/keywordEngineElonLabShopling.ts", "utf8"),
]);

test("keyword engine Elon lab keeps the six fixed Shopling goods keys", () => {
  for (const goodsKey of ["121073", "121065", "121059", "121053", "121050", "121045"]) {
    assert.match(labFile, new RegExp(`"${goodsKey}"`));
  }
});

test("keyword engine Elon lab exposes 42 stages and connects stages one and two", () => {
  const stageCount = [...labFile.matchAll(/index:\s*\d+,\s*key:/g)].length;
  assert.equal(stageCount, 42);
  assert.match(labFile, /index: 2, key: "seed_selection"[\s\S]*implemented: true/);
  assert.match(labFile, /CURRENT_IMPLEMENTED_STAGE = 2/);
  assert.match(routeFile, /const STAGE_TWO =/);
  assert.match(routeFile, /if \(stageKey === STAGE_TWO\.key\) return runStageTwo/);
  assert.match(routeFile, /STEP 2는 STEP 1 최신 결과가 모두 통과된 뒤 실행할 수 있습니다/);
});

test("stage two reproduces the current seed selection rule without redesigning it", () => {
  assert.match(routeFile, /const selectedSeed = productName \|\| modelName \|\| goodsKey/);
  assert.match(routeFile, /currentRule: "prod_nm \|\| model_nm \|\| goods_key"/);
  assert.match(routeFile, /selectedSeedSource/);
  assert.match(routeFile, /selectionReason/);
  assert.match(pageFile, /현행 규칙 그대로 실행: prod_nm → model_nm → goods_key/);
  assert.match(pageFile, /2단계 · 6개 모두 실행/);
});

test("keyword engine Elon lab is registered as an isolated OPS card", () => {
  assert.match(moduleFile, /title: "키워드엔진 일론머스크식 분해개선작업"/);
  assert.match(moduleFile, /route: "\/keyword-engine-elon-lab"/);
  assert.match(moduleFile, /실제 Shopling 쓰기 없음/);
  assert.match(registryFile, /keywordEngineElonLabModule/);
  assert.match(pageFile, /Input/);
  assert.match(pageFile, /Output/);
  assert.match(pageFile, /개선 필요/);
});

test("stage one reads Shopling context without modify endpoints", () => {
  assert.match(shoplingFile, /prod_nm/);
  assert.match(shoplingFile, /model_no/);
  assert.match(shoplingFile, /site_srch/);
  assert.match(shoplingFile, /dtl_desc/);
  assert.doesNotMatch(shoplingFile, /prod_modify_api/);
  assert.doesNotMatch(shoplingFile, /prod_each_mall_modify_api/);
  assert.match(routeFile, /writesEnabled:\s*false/);
});

test("review buttons show local save feedback and apply the server row immediately", () => {
  assert.match(pageFile, /mergeStoredRows/);
  assert.match(pageFile, /const updatedRows = data\.rows \?\? \[\]/);
  assert.match(pageFile, /setRows\(\(current\) => mergeStoredRows\(current, updatedRows\)\)/);
  assert.match(pageFile, /저장 중…/);
  assert.match(pageFile, /✓ \$\{label\} 저장 완료/);
  assert.match(pageFile, /✓ 통과 완료/);
});

test("stage two results become stale when stage one is newer", () => {
  assert.match(pageFile, /function isFreshAfter/);
  assert.match(pageFile, /rowTime\(row\) >= rowTime\(previous\)/);
  assert.match(pageFile, /freshStageTwoRow/);
  assert.match(pageFile, /기존 2단계 결과는 stale로 간주됩니다/);
});
