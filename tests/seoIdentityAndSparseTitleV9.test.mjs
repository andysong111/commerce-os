import assert from "node:assert/strict";
import test from "node:test";

import { repairKeywordElonSourceIdentityV9 } from "../src/lib/keywordEngineElonSourceIdentityGuardV9.ts";
import { composeFreshKeywordElonMallTitles } from "../src/lib/keywordEngineElonFreshMallTitleComposer.ts";

function fallbackSource(title) {
  return {
    url: "https://detail.1688.com/offer/913931320996.html",
    offerId: "913931320996",
    autoStatus: "partial",
    chineseTitle: title,
    optionText: "실버 / 옵션 / BEG5-2",
    supportingText: "욕실 청소용",
    warnings: ["BULK_TRACKER_SOURCE_FALLBACK"],
    collectedAt: new Date().toISOString(),
  };
}

function baseIdentity() {
  return {
    model: "gpt-5-mini",
    reasoning: "욕실청소건을 청소봉으로 해석",
    confidence: 0.85,
    coreProduct: "청소봉",
    koreanProductIdentity: "욕실용 304 스테인리스 청소봉",
    identityAnchor: "욕실용 304 스테인리스 청소봉",
    primarySeeds: ["청소봉", "욕실 청소봉", "스테인리스 청소봉"],
    conditionalSeeds: ["화장실밀대", "청소밀대"],
    functionModifiers: ["욕실 청소용", "청소용 핸들/봉"],
    designShapeModifiers: [],
    specAttributes: ["재질: 304 스테인리스강"],
    variantNoise: ["실버"],
  };
}

test("V9 tracker fallback은 욕실청소건의 '건'을 분사/세척 제품명사로 보존하고 밀대 분기를 제거한다", () => {
  const repaired = repairKeywordElonSourceIdentityV9(
    fallbackSource("304스텐 욕실청소건 실버"),
    baseIdentity(),
  );

  assert.equal(repaired.coreProduct, "청소건");
  assert.equal(repaired.identityAnchor, "욕실청소건");
  assert.equal(repaired.koreanProductIdentity, "욕실청소건");
  assert.ok(repaired.primarySeeds.includes("청소건"));
  assert.ok(repaired.primarySeeds.includes("욕실청소건"));
  assert.ok(
    [...repaired.primarySeeds, ...repaired.conditionalSeeds].every(
      (value) => !/(청소봉|밀대|걸레|막대|바닥솔)/.test(value),
    ),
    JSON.stringify(repaired),
  );
  assert.match(repaired.reasoning, /V9 원문 보호/);
});

test("V9 원문 보호는 실제 1688 원본 분석에는 개입하지 않는다", () => {
  const source = {
    ...fallbackSource("304스텐 욕실청소건 실버"),
    warnings: [],
  };
  const identity = baseIdentity();
  const repaired = repairKeywordElonSourceIdentityV9(source, identity);
  assert.deepEqual(repaired, identity);
});

function markets() {
  return Array.from({ length: 29 }, (_, index) => ({
    productGroup:
      index < 5
        ? "도매1"
        : index < 8
          ? "도매2"
          : index < 11
            ? "도매3"
            : index === 11
              ? "도매4"
              : index < 24
                ? "소매1"
                : "소매2",
    groupSuffix: String(index + 1),
    productGroupType: index < 12 ? "wholesale" : "retail",
    marketName: `테스트몰${index + 1}`,
    mallType: "test",
    mallKey: `TEST_${String(index + 1).padStart(3, "0")}`,
    accountIdLabel: `account-${index + 1}`,
  }));
}

const AAA447_KEYWORDS = [
  "에그스피너",
  "계란거품기",
  "달걀노른자",
  "거품기",
  "스피너",
  "휘핑기",
];

test("V9은 AAA447처럼 안전 직접키워드가 6개뿐이고 검증 모델명이 30bytes를 넘어도 연속 구문만 잘라 29개 장문 제목을 만든다", () => {
  const result = composeFreshKeywordElonMallTitles({
    markets: markets(),
    finalKeywords: AAA447_KEYWORDS,
    titleExpansionPool: [],
    modelName: "스피너형 계란 노른자 믹서",
    context: {
      modelNumber: "AAA447",
      productName: "계란노른자섞기 스피너",
      category: "생활/건강>주방용품>조리도구>기타",
      optionText: "옐로우",
    },
    blockedTerms: ["교정", "성형"],
    variationSeed: "seo-run-v9-sparse-test",
  });

  assert.equal(result.rows.length, 29);
  assert.equal(new Set(result.rows.map((row) => row.title)).size, 29);
  for (const row of result.rows) {
    const bytes = Buffer.byteLength(row.title, "utf8");
    assert.ok(bytes >= 30 && bytes <= 50, `${bytes} ${row.title}`);
  }
  const supportWarning = result.warnings.find((warning) =>
    warning.startsWith("SEO_RUN_SPARSE_TITLE_MODEL_SUPPORTS:"),
  );
  assert.ok(supportWarning, JSON.stringify(result.warnings));
  assert.match(supportWarning, /스피너형 계란/);
  assert.match(supportWarning, /계란 노른자/);
  assert.match(supportWarning, /노른자 믹서/);
});
