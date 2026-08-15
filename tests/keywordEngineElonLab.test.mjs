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

test("keyword engine Elon lab exposes the full decomposition map and only stage one is executable", () => {
  const stageCount = [...labFile.matchAll(/index:\s*\d+,\s*key:/g)].length;
  assert.equal(stageCount, 42);
  assert.match(labFile, /CURRENT_IMPLEMENTED_STAGE = 1/);
  assert.match(routeFile, /stageKey !== STAGE_ONE\.key/);
  assert.match(routeFile, /현재 실험실에서 실제 실행이 연결된 단계는 1단계/);
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

test("review buttons render the server write response immediately instead of waiting for a reread", () => {
  assert.match(pageFile, /mergeStoredRows/);
  assert.match(pageFile, /const updatedRows = data\.rows \?\? \[\]/);
  assert.match(pageFile, /setRows\(\(current\) => mergeStoredRows\(current, updatedRows\)\)/);
  assert.match(pageFile, /저장 완료/);
  assert.doesNotMatch(
    pageFile.match(/const saveReview = async[\s\S]*?\n  };\n\n  const toggleStage/)?.[0] ?? "",
    /await refresh\(\)/,
  );
});
