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
});

test("OPS Center는 서버 저장 테이블·API·발주 연동 프록시를 포함한다", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202607310001_product_launch_tracker_state.sql", import.meta.url),
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
  assert.match(migration, /product_launch_tracker_states/);
  assert.match(stateRoute, /export async function GET/);
  assert.match(stateRoute, /export async function PUT/);
  assert.match(chinaRoute, /CHINA_ORDER_MANAGER_BASE_URL/);
  assert.match(chinaRoute, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
});
