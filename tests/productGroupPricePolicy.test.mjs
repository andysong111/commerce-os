import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingPreview,
  createLaunchItem,
  DEFAULT_POLICY,
} from "../public/product-launch-tracker-app/lib/tracker-core.mjs";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";

const EXPECTED_MULTIPLIERS = {
  wholesale1: 1,
  wholesale2: 1.15,
  wholesale3: 1.1,
  wholesale4: 1.3,
  retail1: 1.3,
  retail2: 1.4,
};
const EXPECTED_PRICES = [10000, 11500, 11000, 13000, 13000, 14000];

function readyItem() {
  const item = createLaunchItem(
    {
      modelNumber: "AAA999",
      productName: "가격정책 테스트",
      shoplingCategory: "생활>잡화",
      selfCodeBase: "PLPOLICY001",
      orderOptions: [
        {
          optionName: "옵션",
          saleOption: "단품",
          barcode: "POLICY-1",
          baseSalePriceKrw: 10000,
          unitCostKrw: 5000,
        },
      ],
      detailPageAsset: {
        html: "<p>상세</p>",
        mainImageUrl: "https://example.com/main.jpg",
      },
    },
    () => "policy-test",
  );
  item.orderOptions[0].optionBarcodeNo = "OB000000000888";
  item.orderOptions[0].optionBarcodeIdentityKey = "B:POLICY-1";
  item.orderOptions[0].optionBarcodeIdentityKind = "B_CODE";
  return item;
}

test("상품그룹 기본 가격정책은 승인된 6개 배수를 사용한다", () => {
  assert.deepEqual(DEFAULT_POLICY.channelMultipliers, EXPECTED_MULTIPLIERS);
});

test("화면 미리보기와 서버 payload가 같은 승인 가격을 생성한다", () => {
  const item = readyItem();
  const preview = buildShoplingPreview(item, DEFAULT_POLICY);
  const payload = buildProductLaunchShoplingPayload(item, {}, "policy-test");
  assert.deepEqual(
    preview.channels.map(({ salePrice }) => salePrice),
    EXPECTED_PRICES,
  );
  assert.deepEqual(
    payload.channels.map(({ salePrice }) => salePrice),
    EXPECTED_PRICES,
  );
});

test("구 정책 배수는 실제 정책 소스에 남아 있지 않는다", async () => {
  const [browserSource, serverSource] = await Promise.all([
    readFile(
      new URL(
        "../public/product-launch-tracker-app/lib/tracker-core.mjs",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/lib/productLaunchTrackerShopling.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(browserSource, /wholesale1:\s*1\.1,/);
  assert.doesNotMatch(browserSource, /wholesale3:\s*1,/);
  assert.doesNotMatch(serverSource, /wholesale1:\s*1\.1,/);
  assert.doesNotMatch(serverSource, /wholesale3:\s*1,/);
});
