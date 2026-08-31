import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  INTERNAL_PRICE_GROUP_MULTIPLIER,
  INTERNAL_PRICE_GROUP_MALLS,
  buildInternalMallPriceTargets,
  internalPriceGroupTarget,
  normalizeInternalPriceGroup,
} from "../src/lib/internalChinaPriceGroupPolicy.ts";
import {
  buildInternalChinaGroupCostPriceDecision,
  INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION,
} from "../src/lib/internalChinaGroupCostPricePolicy.ts";

const [reviewV2, page, importer, parser, importRoute, dispatcher, approvalRoute] =
  await Promise.all([
    readFile("src/lib/internalChinaGroupCostPriceReview.ts", "utf8"),
    readFile("src/app/china-order-manager/price-review/page.tsx", "utf8"),
    readFile("src/lib/shopling/historicalProductGroupImport.ts", "utf8"),
    readFile("src/lib/shopling/historicalProductGroupXlsx.ts", "utf8"),
    readFile(
      "src/app/api/china-order-manager/price-review/product-groups/import/route.ts",
      "utf8",
    ),
    readFile("src/app/api/cron/receipt-live-price-proposals/route.ts", "utf8"),
    readFile(
      "src/app/api/china-order-manager/price-review/group-aware-approve/route.ts",
      "utf8",
    ),
  ]);

test("group multipliers are the validated six-group policy", () => {
  assert.deepEqual(INTERNAL_PRICE_GROUP_MULTIPLIER, {
    도매1: 1,
    도매2: 1.15,
    도매3: 1.1,
    도매4: 1.3,
    소매1: 1.3,
    소매2: 1.4,
  });
  assert.equal(normalizeInternalPriceGroup("도매1번"), "도매1");
  assert.equal(normalizeInternalPriceGroup("미지정"), null);
});

test("group target is cost times units times two times group multiplier rounded up to ten", () => {
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 1000, unitsPerOrder: 1, productGroup: "도매1" }),
    2000,
  );
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 1000, unitsPerOrder: 1, productGroup: "도매2" }),
    2300,
  );
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 1000, unitsPerOrder: 1, productGroup: "도매3" }),
    2200,
  );
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 1000, unitsPerOrder: 1, productGroup: "도매4" }),
    2600,
  );
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 1000, unitsPerOrder: 1, productGroup: "소매1" }),
    2600,
  );
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 1000, unitsPerOrder: 1, productGroup: "소매2" }),
    2800,
  );
  assert.equal(
    internalPriceGroupTarget({ latestCostKrw: 501, unitsPerOrder: 3, productGroup: "도매2" }),
    3460,
  );
});

test("unresolved product group is fail-closed and never guessed", () => {
  const result = buildInternalChinaGroupCostPriceDecision({
    currentPrice: 3000,
    latestCostKrw: 1000,
    previousCostKrw: 900,
    productGroup: "",
  });
  assert.equal(result.direction, "BLOCKED");
  assert.equal(result.blockedReason, "PRODUCT_GROUP_NOT_RESOLVED");
  assert.equal(result.changeRequired, false);
  assert.equal(result.targetPrice, 0);
});

test("group-aware increase and decrease use the current group floor", () => {
  const increase = buildInternalChinaGroupCostPriceDecision({
    currentPrice: 2200,
    latestCostKrw: 1000,
    previousCostKrw: 900,
    productGroup: "도매4",
  });
  assert.equal(increase.targetPrice, 2600);
  assert.equal(increase.direction, "INCREASE");
  assert.equal(increase.groupMultiplier, 1.3);

  const decrease = buildInternalChinaGroupCostPriceDecision({
    currentPrice: 3500,
    latestCostKrw: 1000,
    previousCostKrw: 1400,
    productGroup: "소매2",
  });
  assert.equal(decrease.targetPrice, 2800);
  assert.equal(decrease.direction, "DECREASE");

  const firstCost = buildInternalChinaGroupCostPriceDecision({
    currentPrice: 3500,
    latestCostKrw: 1000,
    previousCostKrw: null,
    productGroup: "소매2",
  });
  assert.equal(firstCost.direction, "HOLD");
});

test("group mall sets and special mall policies are preserved", () => {
  assert.equal(INTERNAL_PRICE_GROUP_MALLS["도매1"].length, 10);
  assert.equal(INTERNAL_PRICE_GROUP_MALLS["도매2"].length, 4);
  assert.equal(INTERNAL_PRICE_GROUP_MALLS["도매3"].length, 4);
  assert.equal(INTERNAL_PRICE_GROUP_MALLS["도매4"].length, 1);
  assert.equal(INTERNAL_PRICE_GROUP_MALLS["소매1"].length, 12);
  assert.equal(INTERNAL_PRICE_GROUP_MALLS["소매2"].length, 5);

  const wholesale1 = buildInternalMallPriceTargets({
    productGroup: "도매1",
    groupTargetPrice: 1000,
  });
  assert.equal(wholesale1.find((row) => row.mallName === "카페24")?.targetPrice, 970);
  assert.equal(wholesale1.find((row) => row.mallName === "도매창고")?.targetPrice, 1500);
  assert.equal(wholesale1.find((row) => row.mallName === "도매꾹")?.targetPrice, 1000);

  const retail1 = buildInternalMallPriceTargets({
    productGroup: "소매1",
    groupTargetPrice: 1000,
  });
  assert.equal(retail1.find((row) => row.mallName === "에이블리")?.targetPrice, 4000);
});

test("v2 proposal resolves registry first and blocks approval while legacy groups are unresolved", () => {
  assert.equal(INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION, "commerce-os-cost-price-group-v2.0.0");
  assert.ok(reviewV2.includes("loadShoplingProductGroupsByGoodsKey"));
  assert.ok(reviewV2.includes("resolveInternalPriceGroup"));
  assert.ok(reviewV2.includes("unresolvedGroupCount > 0"));
  assert.ok(reviewV2.includes("INTERNAL_CHINA_GROUP_COST_PRICE_PROPOSAL_STALE"));
  assert.ok(reviewV2.includes("shoplingWritesEnabled: false"));
  assert.equal(reviewV2.includes("priceGradeEngine"), false);
  assert.equal(reviewV2.includes("productGrade"), false);
});

test("legacy xlsx import treats six filenames as authoritative and refuses conflicts", () => {
  for (const group of ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]) {
    assert.ok(parser.includes(group));
  }
  assert.ok(importer.includes("HISTORICAL_GROUP_SIX_FILES_REQUIRED"));
  assert.ok(importer.includes("HISTORICAL_GROUP_FILE_CONFLICT"));
  assert.ok(importer.includes("HISTORICAL_GROUP_EXISTING_CONFLICT"));
  assert.ok(importer.includes('code_format: "legacy_suffix"'));
  assert.ok(importRoute.includes("regenerateLatestInternalChinaGroupCostPriceProposal"));
  assert.ok(importRoute.includes("실제 Shopling 가격은 변경하지 않았습니다"));
});

test("new SEO products keep Shopling product group unspecified while OPS internal group drives pricing", () => {
  assert.ok(page.includes("신규 SEO 상품은 Shopling 상품그룹을 계속 미지정"));
  assert.ok(page.includes("OPS 내부 가격그룹"));
  assert.ok(page.includes("그룹 기준가 = 확정원가 × 주문당 수량 × 2 × 그룹배수"));
  assert.ok(dispatcher.includes("productGroupGuessingEnabled: false"));
  assert.ok(dispatcher.includes("shoplingProductGroupWritesEnabled: false"));
});

test("v2 approval remains intent-only and old v1 approval is not used by the page", () => {
  assert.ok(page.includes("InternalChinaGroupCostPriceApprovalButton"));
  assert.equal(page.includes("InternalChinaCostPriceApprovalButton"), false);
  assert.ok(approvalRoute.includes("approveInternalChinaGroupCostPriceProposal"));
  assert.ok(approvalRoute.includes("실제 Shopling 판매가격은 아직 변경하지 않습니다"));
  assert.equal(approvalRoute.includes("shoplingApply"), false);
});
