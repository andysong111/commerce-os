import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateKeywordElonIdentityConsistencyV10 } from "../src/lib/keywordEngineElonIdentityConsistencyV10.ts";
import { buildKeywordElonTitleKeywordReservoirV8 } from "../src/lib/keywordEngineElonKeywordPortfolioV8SparseGuardV10.ts";

const gunIdentity = {
  model: "gpt-5-mini",
  reasoning: "욕실 청소용 분사/세척형 건",
  confidence: 0.9,
  coreProduct: "청소건",
  koreanProductIdentity: "욕실청소건",
  identityAnchor: "욕실청소건",
  primarySeeds: ["청소건", "욕실청소건"],
  conditionalSeeds: [],
  functionModifiers: ["욕실용", "청소용", "욕실 청소용"],
  designShapeModifiers: [],
  specAttributes: ["재질: 304 스테인리스"],
  variantNoise: ["실버"],
};

test("V10은 욕실청소건의 인접 시장어 중 건/분사/샤워 계열은 유지하고 별도 청소도구·미확인 기능/성능/구성은 차단한다", () => {
  for (const keyword of [
    "욕실용스프레이건",
    "화장실청소샤워기",
    "물청소건",
    "청소스프레이건",
    "욕실분사기",
    "욕실워터건",
    "세척건",
  ]) {
    assert.equal(
      evaluateKeywordElonIdentityConsistencyV10({ identity: gunIdentity, keyword }).blocked,
      false,
      keyword,
    );
  }

  for (const keyword of [
    "물청소기",
    "전동욕실청소기",
    "무선분사기",
    "자동분무기",
    "고압세척건",
    "수압상승샤워건",
    "절수스프레이건",
    "욕실스프레이건세트",
    "물기제거스퀴지",
    "물기제거기",
    "욕실청소밀대",
  ]) {
    assert.equal(
      evaluateKeywordElonIdentityConsistencyV10({ identity: gunIdentity, keyword }).blocked,
      true,
      keyword,
    );
  }
});

test("V10은 원문 정체성에 실제 확인된 기능·성능·구성까지 무조건 차단하지 않는다", () => {
  const verifiedIdentity = {
    ...gunIdentity,
    functionModifiers: [
      ...gunIdentity.functionModifiers,
      "자동 분사",
      "고압 세척",
      "절수",
    ],
    specAttributes: [...gunIdentity.specAttributes, "구성: 스프레이건 세트"],
  };
  for (const keyword of [
    "자동분사건",
    "고압세척건",
    "절수스프레이건",
    "욕실스프레이건세트",
  ]) {
    assert.equal(
      evaluateKeywordElonIdentityConsistencyV10({
        identity: verifiedIdentity,
        keyword,
      }).blocked,
      false,
      keyword,
    );
  }
});

function candidate(keyword, qualityScore, totalSearch = null) {
  return {
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    sourceTags: ["test"],
    totalSearch,
    pcSearch: null,
    mobileSearch: null,
    compIdx: totalSearch === null ? null : "높음",
    plAvgDepth: totalSearch === null ? null : 8,
    demandScore: totalSearch === null ? 15 : 80,
    competitionOpportunity: totalSearch === null ? 55 : 47,
    relevance: 92,
    shoppingIntent: 85,
    specificity: 88,
    titleEligible: true,
    rationale: "test",
    qualityScore,
    safetyPass: true,
    safetyReason: "pass",
    dataConfidence: totalSearch === null ? "medium" : "high",
  };
}

const AAA447_SAFE = [
  candidate("에그스피너", 46.5),
  candidate("계란거품기", 46.3),
  candidate("달걀노른자", 45.8),
  candidate("거품기", 81.9, 8100),
  candidate("스피너", 44),
  candidate("휘핑기", 78.8, 4650),
];

test("V10 희소 상품은 검색량 미측정이어도 STEP4 통과·관련성 높은 직접키워드 6개를 모두 상품명 재료로 살린다", () => {
  const reservoir = buildKeywordElonTitleKeywordReservoirV8({
    candidates: AAA447_SAFE,
    allowedKeys: AAA447_SAFE.map((row) => row.keyword),
  });
  assert.equal(reservoir.rankedDirectKeywords.length, 6);
  assert.equal(reservoir.titleKeywords.length, 6);
  assert.deepEqual(
    new Set(reservoir.titleKeywords),
    new Set(AAA447_SAFE.map((row) => row.keyword)),
  );
  assert.ok(
    reservoir.warnings.some((warning) =>
      warning.startsWith("SEO_KEYWORD_V10_SPARSE_DIRECT_RESCUE:"),
    ),
  );
});

test("production alias는 STEP4와 V8 reservoir에 V10 guard를 연결한다", async () => {
  const tsconfig = JSON.parse(
    await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(tsconfig.compilerOptions.paths["@/lib/keywordEngineElonLabV2Step4"], [
    "./src/lib/keywordEngineElonLabV2Step4GuardedV10.ts",
  ]);
  assert.deepEqual(
    tsconfig.compilerOptions.paths["@/lib/keywordEngineElonKeywordPortfolioV8"],
    ["./src/lib/keywordEngineElonKeywordPortfolioV8SparseGuardV10.ts"],
  );

  const step4 = await readFile(
    new URL("../src/lib/keywordEngineElonLabV2Step4GuardedV10.ts", import.meta.url),
    "utf8",
  );
  assert.match(step4, /evaluateKeywordElonIdentityConsistencyV10/);
  assert.match(step4, /STEP4_IDENTITY_CONSISTENCY_BLOCKED/);
});
