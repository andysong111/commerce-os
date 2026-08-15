import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildKeywordIdentityProbes } from "../src/lib/keywordEngineElonLabIdentity.ts";

const [labFile, identityFile, moduleFile, registryFile, pageFile, routeFile, shoplingFile, storeFile] = await Promise.all([
  readFile("src/lib/keywordEngineElonLab.ts", "utf8"),
  readFile("src/lib/keywordEngineElonLabIdentity.ts", "utf8"),
  readFile("src/lib/keywordEngineElonLabModule.ts", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8"),
  readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8"),
  readFile("src/lib/keywordEngineElonLabShopling.ts", "utf8"),
  readFile("src/lib/keywordEngineElonLabStore.ts", "utf8"),
]);

test("keyword engine Elon lab keeps the six fixed Shopling goods keys", () => {
  for (const goodsKey of ["121073", "121065", "121059", "121053", "121050", "121045"]) {
    assert.match(labFile, new RegExp(`"${goodsKey}"`));
  }
});

test("keyword engine Elon lab exposes 42 stages and connects stages one through four", () => {
  const stageCount = [...labFile.matchAll(/index:\s*\d+,\s*key:/g)].length;
  assert.equal(stageCount, 42);
  assert.match(labFile, /index: 4, key: "probe_generation"[\s\S]*상품 정체성 구조화 · Probe 생성[\s\S]*implemented: true/);
  assert.match(labFile, /index: 5, key: "related_query_collection"[\s\S]*Primary \+ Conditional Probe/);
  assert.match(labFile, /CURRENT_IMPLEMENTED_STAGE = 4/);
  assert.match(routeFile, /const STAGE_FOUR =/);
  assert.match(routeFile, /if \(stageKey === STAGE_FOUR\.key\) return runStageFour/);
  assert.match(routeFile, /STEP 4는 최신 STEP 3 결과가 모두 통과된 뒤 실행할 수 있습니다/);
  assert.match(pageFile, /stage\.index >= 1 && stage\.index <= 4/);
  assert.match(pageFile, /executionControls\(stage\.index, stageKeyForIndex\(stage\.index\), stageReadyForIndex\(stage\.index\), stagePassForIndex\(stage\.index\)\)/);
});

test("stage two reproduces the current seed selection rule without redesigning it", () => {
  assert.match(routeFile, /const selectedSeed = productName \|\| modelName \|\| goodsKey/);
  assert.match(routeFile, /currentRule: "prod_nm \|\| model_nm \|\| goods_key"/);
  assert.match(routeFile, /selectedSeedSource/);
  assert.match(routeFile, /selectionReason/);
  assert.match(pageFile, /현행 규칙: prod_nm → model_nm → goods_key/);
});

test("stage three exposes the current seed noise removal rule", () => {
  for (const term of ["색상 랜덤", "색상랜덤", "랜덤색상", "무료배송", "당일배송", "랜덤"]) {
    assert.match(routeFile, new RegExp(term));
  }
  assert.match(routeFile, /function cleanCurrentSeed/);
  assert.match(routeFile, /removedExpressions/);
  assert.match(routeFile, /cleanedSeed/);
  assert.match(routeFile, /ops-stage3-current-seed-cleaning-v1/);
  assert.match(pageFile, /현행 제거어: 색상랜덤/);
});

test("stage four uses semantic product identity instead of whitespace probe splitting", () => {
  assert.match(routeFile, /analyzeKeywordEngineIdentityBatch/);
  assert.doesNotMatch(routeFile, /buildCurrentProbeBreakdown/);
  assert.match(routeFile, /analysisMode: "semantic_product_identity_roles"/);
  assert.match(routeFile, /STAGE_FOUR_REVISION/);
  assert.match(identityFile, /coreProduct/);
  assert.match(identityFile, /identityAnchor/);
  assert.match(identityFile, /functionModifiers/);
  assert.match(identityFile, /designShapeModifiers/);
  assert.match(identityFile, /specAttributes/);
  assert.match(identityFile, /variantNoise/);
  assert.match(identityFile, /primaryProbes/);
  assert.match(identityFile, /conditionalProbes/);
  assert.match(identityFile, /blockedSingleProbes/);
  assert.match(identityFile, /곰돌이 자수 반바지 B형/);
  assert.match(identityFile, /투구 골무 핑크/);
  assert.match(pageFile, /STAGE_FOUR_REVISION = "ops-stage4-semantic-identity-v2"/);
  assert.match(pageFile, /row\?\.engine_revision !== STAGE_FOUR_REVISION/);
  assert.match(pageFile, /CORE_PRODUCT/);
  assert.match(pageFile, /IDENTITY_ANCHOR/);
  assert.match(pageFile, /PRIMARY PROBE/);
  assert.match(pageFile, /CONDITIONAL PROBE/);
});

test("stage four generates the agreed bear-shorts probes deterministically", () => {
  const result = buildKeywordIdentityProbes({
    coreProduct: "반바지",
    identityAnchor: "자수 반바지",
    functionModifiers: ["자수"],
    designShapeModifiers: ["곰돌이"],
    specAttributes: [],
    variantNoise: ["B형"],
    uncertainTerms: [],
  });
  assert.deepEqual(result.primaryProbes, ["반바지", "자수 반바지"]);
  assert.deepEqual(result.conditionalProbes, ["곰돌이 반바지", "곰돌이 자수 반바지"]);
  assert.ok(result.blockedSingleProbes.includes("곰돌이"));
  assert.ok(result.blockedSingleProbes.includes("자수"));
  assert.ok(result.blockedSingleProbes.includes("B형"));
  assert.ok(!result.primaryProbes.includes("곰돌이"));
  assert.ok(!result.primaryProbes.includes("B형"));
});

test("stage four generates the agreed helmet-thimble probes deterministically", () => {
  const result = buildKeywordIdentityProbes({
    coreProduct: "골무",
    identityAnchor: "골무",
    functionModifiers: [],
    designShapeModifiers: ["투구"],
    specAttributes: [],
    variantNoise: ["핑크"],
    uncertainTerms: [],
  });
  assert.deepEqual(result.primaryProbes, ["골무"]);
  assert.deepEqual(result.conditionalProbes, ["투구 골무"]);
  assert.ok(result.blockedSingleProbes.includes("투구"));
  assert.ok(result.blockedSingleProbes.includes("핑크"));
});

test("stage four is grounded, fail-closed, and does not use AI to rank market value", () => {
  assert.match(identityFile, /입력 cleanedSeed에 실제로 존재하는 표현만 사용/);
  assert.match(identityFile, /isGrounded/);
  assert.match(identityFile, /상품 핵심명사가 원 Seed에 근거하지 않습니다/);
  assert.match(identityFile, /디자인어가 시장에서 유행할 가능성은 여기서 버리지 않는다/);
  assert.match(identityFile, /Primary=core_product\+identity_anchor/);
  assert.match(identityFile, /OPENAI_KEYWORD_IDENTITY_MODEL/);
  assert.match(identityFile, /store: false/);
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

test("single review buttons show local save feedback and apply the server row immediately", () => {
  assert.match(pageFile, /mergeStoredRows/);
  assert.match(pageFile, /const updatedRows = data\.rows \?\? \[\]/);
  assert.match(pageFile, /setRows\(\(current\) => mergeStoredRows\(current, updatedRows\)\)/);
  assert.match(pageFile, /저장 중…/);
  assert.match(pageFile, /✓ \$\{label\} 저장 완료/);
  assert.match(pageFile, /✓ 통과 완료/);
});

test("each implemented stage supports a six-goods bulk pass through common controls", () => {
  assert.match(routeFile, /action === "review_stage_batch"/);
  assert.match(routeFile, /updateKeywordEngineElonLabReviews/);
  assert.match(routeFile, /일괄 통과는 고정 테스트 goods_key 6개 전체에만 적용/);
  assert.match(routeFile, /isCurrentReviewableRow/);
  assert.match(pageFile, /saveBulkPass/);
  assert.match(pageFile, /6개 일괄 통과/);
  assert.match(pageFile, /const executionControls =/);
  assert.match(pageFile, /saveBulkPass\(stageKey, stageNumber\)/);
  assert.match(pageFile, /stageKeyForIndex/);
  assert.match(pageFile, /stageReadyForIndex/);
  assert.match(pageFile, /stagePassForIndex/);
  assert.match(pageFile, /stage\.index >= 1 && stage\.index <= 4/);
});

test("review-only writes do not mutate execution updated_at", () => {
  assert.match(storeFile, /updated_at intentionally represents the stage execution result timestamp/);
  const patchSection = storeFile.slice(
    storeFile.indexOf("async function patchKeywordEngineElonLabReview"),
    storeFile.indexOf("export async function updateKeywordEngineElonLabReview"),
  );
  assert.doesNotMatch(patchSection, /updated_at:\s*new Date/);
  assert.match(storeFile, /updateKeywordEngineElonLabReviews/);
});

test("refresh and deployments resume from persisted Supabase progress", () => {
  assert.match(pageFile, /RESUME_STORAGE_KEY = "keywordEngineElonLab\.resumeStage\.v1"/);
  assert.match(pageFile, /const resumeStage = !stageOnePassed/);
  assert.match(pageFile, /window\.localStorage\.getItem\(RESUME_STORAGE_KEY\)/);
  assert.match(pageFile, /window\.localStorage\.setItem\(RESUME_STORAGE_KEY/);
  assert.match(pageFile, /stage\.index === resumeStage/);
  assert.match(pageFile, /expandedStages\.has\(stage\.index\) \|\| stage\.index === resumeStage/);
  assert.match(pageFile, /현재 이어서 작업: STEP \{resumeStage\}/);
  assert.match(pageFile, /Supabase의 실행\/통과 결과를 기준으로 현재 STEP을 다시 계산/);
  assert.match(pageFile, /STEP \{resumeStage\}로 이동/);
});

test("rerunning an executed stage warns that review state will reset", () => {
  assert.match(pageFile, /window\.confirm/);
  assert.match(pageFile, /판정이 모두 검수대기로 초기화/);
  assert.match(pageFile, /결과 재실행 · 판정 초기화/);
});

test("downstream stage rows are fresh and old step-four revision is rejected", () => {
  assert.match(pageFile, /function freshAfter/);
  assert.match(pageFile, /rowTime\(row\) >= rowTime\(previous\)/);
  assert.match(pageFile, /row\?\.engine_revision !== STAGE_FOUR_REVISION/);
  assert.match(pageFile, /stageTwoRow/);
  assert.match(pageFile, /stageThreeRow/);
  assert.match(pageFile, /stageFourRow/);
});
