import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendShippingNotice,
  assignMissingSelfCodes,
  buildShoplingPreview,
  createLaunchItem,
  DEFAULT_POLICY,
  getShoplingReadiness,
  SHOPLING_CHANNELS,
} from "../public/product-launch-tracker-app/lib/tracker-core.mjs";
import {
  buildProductLaunchShoplingPayload,
} from "../src/lib/productLaunchTrackerShopling.ts";

function readyItem() {
  return createLaunchItem(
    {
      modelNumber: "AAA500",
      productName: "테스트 상품",
      shoplingCategory: "생활>잡화",
      selfCodeBase: "PLTEST000001",
      orderOptions: [
        {
          saleOption: "블랙",
          barcode: "BAA1-1",
          baseSalePriceKrw: 10000,
          unitCostKrw: 5000,
        },
        {
          saleOption: "화이트",
          barcode: "BAA1-2",
          baseSalePriceKrw: 12000,
          unitCostKrw: 6000,
        },
        {
          saleOption: "대형",
          barcode: "BAA1-3",
          baseSalePriceKrw: 15000,
          unitCostKrw: 7500,
        },
      ],
      detailPageAsset: {
        html: "<p>상세</p>",
        mainImageUrl: "https://example.com/main.jpg",
      },
    },
    () => "one",
  );
}

function seoFinal() {
  return {
    productName: "틈새 청소브러시",
    groupProductNames: {
      wholesale1: "틈새 청소브러시 욕실청소솔",
      wholesale2: "주방청소솔 틈새 청소브러시",
      wholesale3: "틈새 청소브러시 다용도솔",
      wholesale4: "세척브러시 틈새 청소브러시",
      retail1: "욕실청소솔 틈새 청소브러시",
      retail2: "틈새청소 틈새 청소브러시",
    },
    searchKeywords: [
      "청소브러시",
      "틈새브러시",
      "욕실청소솔",
      "주방청소솔",
      "세척브러시",
      "다용도솔",
      "청소도구",
      "틈새청소",
      "욕실솔",
      "주방솔",
    ],
    searchLine: "이 값은 서버에서 검색어 배열 기준으로 다시 정규화한다",
    source: "keyword-engine-elon-lab",
    sourceUrl: "https://detail.1688.com/offer/123456.html",
    offerId: "123456",
    generatedAt: "2026-08-23T00:00:00.000Z",
  };
}

test("기존 상품에 중복되지 않는 자사상품 기본코드를 자동 배정한다", () => {
  const result = assignMissingSelfCodes(
    [
      { id: "keep", selfCodeBase: "PLKEEP00001" },
      { id: "new", selfCodeBase: "" },
    ],
    () => "CCCCCCCCCC",
  );
  assert.equal(result.items[0].selfCodeBase, "PLKEEP00001");
  assert.equal(result.items[1].selfCodeBase, "PLCCCCCCCCCC");
  assert.equal(result.changed, true);
});

test("6채널 자사상품코드 접미사와 최초 상품명을 생성한다", () => {
  const preview = buildShoplingPreview(readyItem(), DEFAULT_POLICY);
  assert.equal(preview.ready, true);
  assert.deepEqual(SHOPLING_CHANNELS.map(({ suffix }) => suffix), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(
    preview.channels.map(({ ptnGoodsCd }) => ptnGoodsCd),
    [
      "PLTEST000001a",
      "PLTEST000001b",
      "PLTEST000001c",
      "PLTEST000001d",
      "PLTEST000001e",
      "PLTEST000001f",
    ],
  );
  assert.equal(preview.channels[0].productName, "테스트 상품 도매1");
  assert.equal(preview.channels[4].brandName, "동네일등");
});

test("옵션별 최종가 차액으로 샵플링 옵션 추가금을 계산한다", () => {
  const preview = buildShoplingPreview(readyItem(), DEFAULT_POLICY);
  const retail2 = preview.channels.find(({ label }) => label === "소매2");
  assert.equal(retail2.salePrice, 14000);
  assert.equal(retail2.listPrice, 21000);
  assert.deepEqual(
    retail2.options.map(({ additionalAmountKrw }) => additionalAmountKrw),
    [0, 2800, 7000],
  );
});

test("서버 실행 payload도 화면 미리보기와 동일한 가격·코드를 생성한다", () => {
  const item = readyItem();
  const browserPreview = buildShoplingPreview(item, DEFAULT_POLICY);
  const serverPayload = buildProductLaunchShoplingPayload(
    item,
    DEFAULT_POLICY,
    "request-test",
  );
  assert.deepEqual(
    serverPayload.channels.map(({ ptnGoodsCd }) => ptnGoodsCd),
    browserPreview.channels.map(({ ptnGoodsCd }) => ptnGoodsCd),
  );
  assert.deepEqual(
    serverPayload.channels.map(({ salePrice }) => salePrice),
    browserPreview.channels.map(({ salePrice }) => salePrice),
  );
  assert.deepEqual(
    serverPayload.channels[5].options.map(({ additionalAmountKrw }) => additionalAmountKrw),
    [0, 2800, 7000],
  );
  assert.equal(serverPayload.siteSearch, "");
  assert.equal(serverPayload.seoFinal, null);
});

test("SEO FINAL 상품명 6개와 검색어 10개를 실제 Shopling payload에 반영한다", () => {
  const item = readyItem();
  item.seoFinal = seoFinal();
  const payload = buildProductLaunchShoplingPayload(
    item,
    DEFAULT_POLICY,
    "request-seo-final",
  );
  assert.equal(payload.channels[0].productName, "틈새 청소브러시 욕실청소솔");
  assert.equal(payload.channels[4].productName, "욕실청소솔 틈새 청소브러시");
  assert.equal(payload.channels[0].productAbbreviation, "틈새 청소브러시");
  assert.equal(
    payload.siteSearch,
    "청소브러시,틈새브러시,욕실청소솔,주방청소솔,세척브러시,다용도솔,청소도구,틈새청소,욕실솔,주방솔",
  );
  assert.deepEqual(payload.seoFinal?.searchKeywords, seoFinal().searchKeywords);
});

test("SEO FINAL 검색어가 정확히 10개가 아니면 실제 등록 payload 생성을 차단한다", () => {
  const item = readyItem();
  item.seoFinal = {
    ...seoFinal(),
    searchKeywords: seoFinal().searchKeywords.slice(0, 9),
  };
  assert.throws(
    () => buildProductLaunchShoplingPayload(item, DEFAULT_POLICY),
    /정확히 10개/,
  );
});

test("상품정보고시 38의 모든 속성은 상세설명 참고로 생성한다", () => {
  const preview = buildShoplingPreview(readyItem(), DEFAULT_POLICY);
  assert.equal(preview.goodsNotice.code, "38");
  assert.equal(Object.keys(preview.goodsNotice.attributes).length, 11);
  assert.ok(
    Object.values(preview.goodsNotice.attributes).every(
      (value) => value === "상세설명 참고",
    ),
  );
});

test("배송공지 HTML은 상세페이지 끝에 한 번만 붙는다", () => {
  const notice = "<img src='https://example.com/notice.jpg' />";
  const once = appendShippingNotice("<p>상세</p>", notice);
  assert.equal(appendShippingNotice(once, notice), once);
});

test("카테고리·상세페이지·옵션가격 누락은 등록을 차단한다", () => {
  const item = createLaunchItem(
    {
      modelNumber: "AAA501",
      productName: "누락 상품",
      selfCodeBase: "PLTEST000002",
      orderOptions: [
        { saleOption: "단품", barcode: "", baseSalePriceKrw: 0 },
      ],
    },
    () => "blocked",
  );
  const readiness = getShoplingReadiness(item);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.errors.some((message) => message.includes("카테고리")));
  assert.ok(readiness.errors.some((message) => message.includes("상세페이지")));
  assert.ok(readiness.errors.some((message) => message.includes("기준 판매가")));
  assert.throws(
    () => buildProductLaunchShoplingPayload(item, DEFAULT_POLICY),
    /카테고리/,
  );
});

test("OPS Center는 서버 저장·실제 업로드·발주 연동 경로를 포함한다", async () => {
  const stateMigration = await readFile(
    new URL("../supabase/migrations/202607310001_product_launch_tracker_state.sql", import.meta.url),
    "utf8",
  );
  const jobMigration = await readFile(
    new URL("../supabase/migrations/202607310002_product_launch_upload_jobs.sql", import.meta.url),
    "utf8",
  );
  const stateRoute = await readFile(
    new URL("../src/app/api/product-launch-tracker/state/route.ts", import.meta.url),
    "utf8",
  );
  const chinaRoute = await readFile(
    new URL("../src/app/api/product-launch-tracker/china-order-options/route.ts", import.meta.url),
    "utf8",
  );
  const uploadRoute = await readFile(
    new URL("../src/app/api/product-launch-tracker/shopling-upload/route.ts", import.meta.url),
    "utf8",
  );
  const workerRoute = await readFile(
    new URL("../src/app/api/product-launch-tracker/upload-jobs/[jobId]/route.ts", import.meta.url),
    "utf8",
  );
  const uploadUi = await readFile(
    new URL("../public/product-launch-tracker-app/shopling-upload-ui.js", import.meta.url),
    "utf8",
  );
  const seoUploadPanel = await readFile(
    new URL("../src/app/keyword-engine-elon-lab/SeoFinalShoplingUploadPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(stateMigration, /product_launch_tracker_states/);
  assert.match(jobMigration, /product_launch_upload_jobs/);
  assert.match(stateRoute, /export async function GET/);
  assert.match(stateRoute, /export async function PUT/);
  assert.match(chinaRoute, /CHINA_ORDER_MANAGER_BASE_URL/);
  assert.match(chinaRoute, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(uploadRoute, /shopling-product-launch-upload\.yml/);
  assert.match(workerRoute, /PRODUCT_LAUNCH_UPLOAD_SECRET/);
  assert.match(uploadUi, /실제 샵플링 6채널 등록/);
  assert.match(seoUploadPanel, /SEO 확정 → Shopling 6채널 실제등록/);
  assert.match(seoUploadPanel, /partialPage: true/);
});
