import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const outputModuleUrl = pathToFileURL(
  path.resolve("src/lib/keywordEngineElonLabSeoOutput.ts"),
).href;

async function tempImport(sourcePath, replacements) {
  let source = await readFile(sourcePath, "utf8");
  for (const [pattern, replacement] of replacements) {
    source = source.replace(pattern, replacement);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "seo-cloud-v3-"));
  const temporaryPath = path.join(directory, path.basename(sourcePath));
  await writeFile(temporaryPath, source, "utf8");
  return {
    url: pathToFileURL(temporaryPath).href,
    module: await import(`${pathToFileURL(temporaryPath).href}?v=${Date.now()}`),
  };
}

async function importGuaranteedGenerator() {
  const generator = await tempImport(
    "src/lib/seoTitleInventoryGenerator.ts",
    [[
      /from\s+["']@\/lib\/keywordEngineElonLabSeoOutput["']/,
      `from ${JSON.stringify(outputModuleUrl)}`,
    ]],
  );
  return tempImport(
    "src/lib/seoTitleInventoryGuaranteed.ts",
    [
      [
        /from\s+["']@\/lib\/keywordEngineElonLabSeoOutput["']/,
        `from ${JSON.stringify(outputModuleUrl)}`,
      ],
      [
        /from\s+["']@\/lib\/seoTitleInventoryGenerator["']/,
        `from ${JSON.stringify(generator.url)}`,
      ],
    ],
  );
}

function material(keyword, index) {
  return {
    keyword,
    score: 90 - index,
    relevance: 92 - index,
    shoppingIntent: 78,
    specificity: 80 - index,
    qualityScore: 76 - index,
    demandScore: 62 - index,
    totalSearch: null,
    origin: "step4",
    sourceMaterials: [keyword],
  };
}

const SPARSE_KEYWORDS = [
  "발지압판",
  "발바닥지압",
  "지압발판",
  "발지압기",
  "발바닥지압판",
].map(material);

const SPARSE_FACTS = [
  "발바닥용",
  "색상랜덤",
  "실내용",
  "마사지용",
  "보드형",
  "홈트",
  "발관리",
  // These are routing/market labels, not product facts, and must be rejected.
  "쿠팡",
  "스마트스토어",
  "도매꾹",
];

const MARKETPLACE_PATTERN = /쿠팡|스마트스토어|네이버|옥션|지마켓|11번가|에이블리|도매꾹|오너클랜/;

test("키워드가 빈약한 과거상품도 검증 FACT와 어순 fallback으로 정확히 145개를 만든다", async () => {
  const { module } = await importGuaranteedGenerator();
  const result = module.generateGuaranteedSeoTitleInventory({
    modelName: "지압스텝퍼",
    searchKeywords: SPARSE_KEYWORDS,
    extraMaterials: SPARSE_FACTS,
    rounds: 5,
  });

  assert.equal(result.targetCount, 145);
  assert.equal(result.generatedCount, 145, result.warnings.join("\n"));
  assert.equal(result.candidates.length, 145);
  assert.equal(new Set(result.candidates.map((row) => row.titleFingerprint)).size, 145);
  assert.equal(Object.values(result.groupShortages).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(Object.values(result.gradeCounts).reduce((sum, value) => sum + value, 0), 145);
  assert.ok(result.gradeCounts.B + result.gradeCounts.C + result.gradeCounts.D > 0);
  for (const candidate of result.candidates) {
    assert.ok(new TextEncoder().encode(candidate.title).length <= 50, candidate.title);
    assert.equal(candidate.title.split("지압스텝퍼").length - 1, 1, candidate.title);
    assert.doesNotMatch(candidate.title, /프리미엄|베스트|최고|인기상품|추천상품/);
    assert.doesNotMatch(candidate.title, MARKETPLACE_PATTERN, candidate.title);
    for (const sourceMaterial of candidate.sourceMaterials) {
      assert.doesNotMatch(sourceMaterial, MARKETPLACE_PATTERN, sourceMaterial);
    }
  }
});

test("마켓별 SEO profile은 B2B·네이버·쿠팡·에이블리를 구분하고 A/B FACT를 직접 사용한다", async () => {
  const { module } = await tempImport(
    "src/lib/keywordEngineElonMarketSeoProfiles.ts",
    [[
      /from\s+["']@\/lib\/keywordEngineElonLabSeoOutput["']/,
      `from ${JSON.stringify(outputModuleUrl)}`,
    ]],
  );
  const identity = {
    coreProduct: "청소브러시",
    koreanProductIdentity: "걸이형 틈새 청소브러시",
    identityAnchor: "걸이형 틈새 청소브러시",
    primarySeeds: ["틈새청소"],
    conditionalSeeds: ["주방", "욕실"],
    functionModifiers: ["먼지제거", "청소"],
    designShapeModifiers: ["걸이형", "롱형"],
    specAttributes: [],
  };
  const keywords = [
    "틈새청소브러시",
    "창틀청소",
    "주방청소",
    "욕실청소",
    "먼지제거브러시",
    "롱브러시",
    "걸이형브러시",
    "모서리청소",
    "좁은공간청소",
    "청소솔",
  ].map((keyword, index) => ({
    keyword,
    score: 95 - index,
    relevance: 96 - index,
    shoppingIntent: 82,
    specificity: 84,
    qualityScore: 80,
    demandScore: 78 - index * 2,
    totalSearch: 10000 - index * 500,
    origin: "step4",
    sourceMaterials: [keyword],
  }));
  const rows = [
    { productGroup: "도매1", marketName: "도매꾹", mallKey: "SMALL_00069", accountIdLabel: "a", title: "청소브러시 틈새청소" },
    { productGroup: "소매1", marketName: "스마트스토어", mallKey: "SMALL_00004", accountIdLabel: "b", title: "청소브러시 틈새청소" },
    { productGroup: "소매1", marketName: "쿠팡", mallKey: "SMALL_00012", accountIdLabel: "c", title: "청소브러시 틈새청소" },
    { productGroup: "소매1", marketName: "에이블리", mallKey: "SMALL_00112", accountIdLabel: "d", title: "청소브러시 틈새청소" },
  ];

  const result = module.applyKeywordElonMarketSeoProfiles({
    rows,
    modelName: "청소브러시",
    identity,
    searchKeywords: keywords,
    factMaterials: ["30cm", "색상랜덤", "파우치포함"],
  });
  assert.equal(result.rows.length, 4);
  assert.equal(result.profileCounts.B2B, 1);
  assert.equal(result.profileCounts.NAVER, 1);
  assert.equal(result.profileCounts.COUPANG, 1);
  assert.equal(result.profileCounts.ABLY, 1);
  assert.ok(new Set(result.rows.map((row) => row.title)).size >= 3);
  assert.ok(result.rows.some((row) => /30cm|색상랜덤|파우치포함/.test(row.title)));
  for (const row of result.rows) {
    assert.ok(new TextEncoder().encode(row.title).length <= 50, row.title);
    assert.equal(row.title.split("청소브러시").length - 1, 1, row.title);
  }
});

test("공통 검색어 10개는 역할과 A/B tier를 기록하면서 10개를 유지한다", async () => {
  const { module } = await tempImport(
    "src/lib/keywordEngineElonSearchKeywordBalance.ts",
    [[
      /from\s+["']@\/lib\/keywordEngineElonLabSeoOutput["']/,
      `from ${JSON.stringify(outputModuleUrl)}`,
    ]],
  );
  const identity = {
    coreProduct: "청소브러시",
    primarySeeds: ["틈새청소브러시"],
    conditionalSeeds: ["주방청소", "욕실청소"],
    functionModifiers: ["먼지제거"],
    designShapeModifiers: ["걸이형", "롱형"],
    specAttributes: ["30cm"],
  };
  const details = [
    "틈새청소브러시",
    "창틀브러시",
    "주방청소",
    "욕실청소",
    "먼지제거",
    "걸이형브러시",
    "롱브러시",
    "30cm브러시",
    "모서리청소",
    "좁은공간청소",
    "청소솔",
    "틈새솔",
  ].map((keyword, index) => ({
    keyword,
    relevance: 94 - index,
    qualityScore: 82 - index,
    shoppingIntent: 80,
    specificity: 78,
    demandScore: 70 - index,
    totalSearch: 5000 - index * 200,
    score: 90 - index,
    origin: "step4",
    sourceMaterials: [keyword],
  }));
  const result = module.selectBalancedKeywordElonSearchKeywords({
    identity,
    searchKeywordDetails: details,
    baseKeywords: details.slice(0, 10).map((row) => row.keyword),
    supplementalKeywords: details.slice(10).map((row) => row.keyword),
    limit: 10,
  });
  assert.equal(result.keywords.length, 10);
  assert.equal(result.details.length, 10);
  assert.equal(result.tierCounts.A + result.tierCounts.B, 10);
  assert.ok(Object.values(result.roleCounts).filter((value) => value > 0).length >= 3);
});

test("상품출시 handoff와 재고 sync는 1688 없는 과거상품을 더 이상 차단하지 않는다", async () => {
  const [handoff, bulkFinal, inventorySync, ledgerRoute, guaranteed] = await Promise.all([
    readFile("public/product-launch-tracker-app/seo-title-ledger-handoff.js", "utf8"),
    readFile("src/lib/keywordEngineElonBulkFinal.ts", "utf8"),
    readFile("src/lib/seoTitleBulkInventorySync.ts", "utf8"),
    readFile("src/app/api/seo-title-ledger/route.ts", "utf8"),
    readFile("src/lib/seoTitleInventoryGuaranteed.ts", "utf8"),
  ]);

  assert.match(handoff, /legacy:\/\/product-launch\//);
  assert.doesNotMatch(handoff, /개 상품에 1688 링크가 없습니다/);
  assert.match(bulkFinal, /BULK_LEGACY_SOURCE_FALLBACK/);
  assert.match(bulkFinal, /factMaterials: titleFacts/);
  assert.doesNotMatch(bulkFinal, /if \(!text\(input\.sourceUrl\)\) throw new Error\("1688 상품 링크가 없습니다/);
  assert.match(inventorySync, /generateGuaranteedSeoTitleInventory/);
  assert.match(inventorySync, /legacy:\/\/product-launch\//);
  assert.doesNotMatch(inventorySync, /source_url_not_ready/);
  assert.match(inventorySync, /"available", "reserved", "review", "used"/);
  assert.match(ledgerRoute, /generateGuaranteedSeoTitleInventory/);
  assert.doesNotMatch(ledgerRoute, /throw new Error\("1688 상품 링크가 필요합니다/);
  assert.match(guaranteed, /MARKETPLACE_NAME_PATTERN/);
  assert.match(guaranteed, /sanitizeGenerationInput/);
});
