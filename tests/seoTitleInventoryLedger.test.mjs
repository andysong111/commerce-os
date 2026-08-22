import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";

async function importGenerator() {
  const sourcePath = path.resolve("src/lib/seoTitleInventoryGenerator.ts");
  const outputModuleUrl = pathToFileURL(
    path.resolve("src/lib/keywordEngineElonLabSeoOutput.ts"),
  ).href;
  const source = (await readFile(sourcePath, "utf8")).replace(
    /from\s+["']@\/lib\/keywordEngineElonLabSeoOutput["']/,
    `from ${JSON.stringify(outputModuleUrl)}`,
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "seo-title-generator-"));
  const temporaryPath = path.join(directory, "seoTitleInventoryGenerator.ts");
  await writeFile(temporaryPath, source, "utf8");
  return import(`${pathToFileURL(temporaryPath).href}?v=${Date.now()}`);
}

function material(keyword, index) {
  return {
    keyword,
    score: 96 - index * 0.7,
    relevance: 98 - (index % 5),
    shoppingIntent: 94 - (index % 4),
    specificity: 96 - (index % 6),
    qualityScore: 90 - (index % 7),
    demandScore: 84 - (index % 8),
    totalSearch: 10000 - index * 240,
    origin: "step4",
    sourceMaterials: [keyword],
  };
}

const MATERIALS = [
  "차량용",
  "LED조명",
  "뚜껑형",
  "휴대용",
  "차량수납",
  "자동차용",
  "슬림형",
  "컵홀더형",
  "야간조명",
  "차량정리",
  "미니형",
  "뚜껑",
  "차량실내",
  "자동차실내",
  "조명형",
  "소형",
  "원터치",
  "차량컵홀더",
  "실내용",
  "차량보관",
].map(material);

function occurrenceCount(title, modelName) {
  const titleKey = keywordElonSeoCanonical(title);
  const modelKey = keywordElonSeoCanonical(modelName);
  let count = 0;
  let offset = 0;
  while (offset <= titleKey.length - modelKey.length) {
    const index = titleKey.indexOf(modelKey, offset);
    if (index < 0) break;
    count += 1;
    offset = index + modelKey.length;
  }
  return count;
}

test("five-round inventory generates 145 globally unique 50-byte titles", async () => {
  const {
    generateSeoTitleInventory,
    SEO_TITLE_FULL_MARKET_SIZE,
    SEO_TITLE_GROUP_QUOTAS,
  } = await importGenerator();

  const result = generateSeoTitleInventory({
    modelName: "LED 재떨이",
    searchKeywords: MATERIALS,
    extraMaterials: ["차량 액세서리", "자동차 인테리어", "실내 정리"],
    rounds: 5,
  });

  assert.equal(SEO_TITLE_FULL_MARKET_SIZE, 29);
  assert.equal(result.targetCount, 145);
  assert.equal(result.generatedCount, 145, result.warnings.join("\n"));
  assert.equal(result.candidates.length, 145);
  assert.equal(new Set(result.candidates.map((row) => row.titleFingerprint)).size, 145);
  assert.equal(new Set(result.candidates.map((row) => row.semanticFingerprint)).size, 145);

  for (const [group, quota] of Object.entries(SEO_TITLE_GROUP_QUOTAS)) {
    assert.equal(result.groupGenerated[group], quota * 5, `${group} inventory`);
    assert.equal(result.groupShortages[group], 0, `${group} shortage`);
  }

  for (const candidate of result.candidates) {
    assert.ok(candidate.title.length > 0);
    assert.ok(keywordElonSeoUtf8Bytes(candidate.title) <= 50, candidate.title);
    assert.equal(occurrenceCount(candidate.title, "LED 재떨이"), 1, candidate.title);
    assert.doesNotMatch(candidate.title, /도매|대량|납품|제조지|원산지|중국|광동|포장단위/);
  }
});

test("previously issued title and semantic fingerprints are never generated again", async () => {
  const { generateSeoTitleInventory } = await importGenerator();
  const first = generateSeoTitleInventory({
    modelName: "LED 재떨이",
    searchKeywords: MATERIALS,
    extraMaterials: ["차량 액세서리", "자동차 인테리어", "실내 정리"],
    rounds: 1,
  });
  assert.equal(first.generatedCount, 29, first.warnings.join("\n"));

  const second = generateSeoTitleInventory({
    modelName: "LED 재떨이",
    searchKeywords: MATERIALS,
    extraMaterials: ["차량 액세서리", "자동차 인테리어", "실내 정리", "차량 편의", "차량 실내소품"],
    rounds: 1,
    existingTitleFingerprints: first.candidates.map((row) => row.titleFingerprint),
    existingSemanticFingerprints: first.candidates.map((row) => row.semanticFingerprint),
  });
  assert.equal(second.generatedCount, 29, second.warnings.join("\n"));
  const firstTitles = new Set(first.candidates.map((row) => row.titleFingerprint));
  const firstSemantics = new Set(first.candidates.map((row) => row.semanticFingerprint));
  assert.equal(second.candidates.some((row) => firstTitles.has(row.titleFingerprint)), false);
  assert.equal(second.candidates.some((row) => firstSemantics.has(row.semanticFingerprint)), false);
});

test("persistent ledger schema has inventory, dispatch, stats and atomic reservation controls", async () => {
  const migration = await readFile(
    "supabase/migrations/202608220001_seo_title_inventory_ledger.sql",
    "utf8",
  );
  const triggerFix = await readFile(
    "supabase/migrations/202608220002_fix_seo_title_inventory_trigger.sql",
    "utf8",
  );
  for (const name of [
    "seo_title_ledgers",
    "seo_title_inventory",
    "seo_title_dispatches",
    "seo_title_dispatch_items",
    "seo_title_ledger_inventory_stats",
    "reserve_seo_title_inventory",
    "release_seo_title_reservation",
    "finalize_seo_title_reservation",
  ]) {
    assert.match(migration, new RegExp(name));
  }
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /octet_length\(title\) <= 50/i);
  assert.match(migration, /enable row level security/i);
  assert.match(triggerFix, /tg_op = 'DELETE'/i);
});

test("dispatch center is reservation-only and product launch provides one-item cloud handoff", async () => {
  const dispatchRoute = await readFile(
    "src/app/api/seo-title-dispatch/route.ts",
    "utf8",
  );
  const dispatchUi = await readFile(
    "src/app/shopling-seo-dispatch/ShoplingSeoDispatchCenter.tsx",
    "utf8",
  );
  const trackerHandoff = await readFile(
    "public/product-launch-tracker-app/seo-title-ledger-handoff.js",
    "utf8",
  );
  const trackerBootstrap = await readFile(
    "public/product-launch-tracker-app/app.js",
    "utf8",
  );
  const moduleRegistry = await readFile("src/lib/opsModuleRegistry.ts", "utf8");
  const keywordModule = await readFile(
    "src/lib/keywordEngineElonLabModule.ts",
    "utf8",
  );

  assert.match(dispatchRoute, /externalWriteExecuted:\s*false/);
  assert.doesNotMatch(dispatchRoute, /keyword-shopling-direct-apply|shopling-upload|dispatchKeywordShoplingDirectApply/);
  assert.match(dispatchUi, /외부 전송 버튼을 열지 않습니다/);
  assert.match(trackerHandoff, /선택 상품 SEO 대량등록 클라우드 열기/);
  assert.match(trackerHandoff, /selectedIds\.length !== 1/);
  assert.match(trackerHandoff, /primaryChinaProductLink/);
  assert.match(trackerBootstrap, /seo-title-ledger-handoff\.js/);
  assert.match(moduleRegistry, /shoplingSeoDispatchModule/);
  assert.match(keywordModule, /SEO 대량등록 클라우드/);
});
