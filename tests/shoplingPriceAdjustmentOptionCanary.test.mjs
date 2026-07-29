import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { importTranspiledTypeScript } from "./helpers/importTranspiledTypeScript.mjs";

process.env.SHOPLING_PRICE_MODIFY_REPO = "andysong111/shopling-price-modify-auto";
process.env.SHOPLING_PRICE_MODIFY_REF = "main";
process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN = "test-token";
process.env.SHOPLING_PRICE_MODIFY_ENABLED = "1";

const runner = await importTranspiledTypeScript(new URL("../src/lib/shoplingPriceAdjustmentOptionCanaryRunner.ts", import.meta.url));

const input = {
  goods_key: "119836",
  adjustment_bps: 1000,
  expected_current_sell_price: 10000,
  expected_option_signature: "a".repeat(64),
};

test("option canary validates an exact one-product read-only snapshot", () => {
  assert.deepEqual(runner.validateShoplingPriceAdjustmentOptionCanaryInput(input), input);
  assert.throws(() => runner.validateShoplingPriceAdjustmentOptionCanaryInput({ ...input, extra: true }), /필드/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentOptionCanaryInput({ ...input, expected_option_signature: "bad" }), /옵션 서명/);
});

test("dispatch targets the isolated option workflow with explicit confirmation", () => {
  const request = runner.buildShoplingPriceAdjustmentOptionCanaryDispatch(input);
  assert.match(request.requestId, /^price-adjust-option-canary-/);
  assert.match(request.url, /shopling-price-adjustment-option-canary\.yml\/dispatches$/);
  assert.equal(request.body.ref, "main");
  assert.equal(request.body.inputs.confirmation_text, "CONFIRM_OPTION_PRICE_ADJUSTMENT_CANARY");
  assert.deepEqual(JSON.parse(request.body.inputs.option_canary_json), input);
});

test("option canary summary artifact extraction accepts only its dedicated filename", () => {
  const summary = { status: "success", request_id: "price-adjust-option-canary-20260729T120000Z-abcdef", option_target_verified: true };
  const zip = zipSync({
    "output/github_actions/price_adjustment_option_canary_summary.json": strToU8(JSON.stringify(summary)),
  });
  assert.deepEqual(runner.extractShoplingPriceAdjustmentOptionCanarySummary(zip), summary);
  assert.throws(() => runner.extractShoplingPriceAdjustmentOptionCanarySummary(zipSync({ "other.json": strToU8("{}") })), /summary/);
});

test("option canary UI is separate, manual, and wired below the main runner", async () => {
  const [page, panel, runRoute, resultRoute] = await Promise.all([
    readFile(new URL("../src/app/shopling-price-adjustment-runner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-adjustment/ShoplingPriceAdjustmentOptionCanaryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/shopling-price-adjustment/option-canary/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/shopling-price-adjustment/option-canary/result/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /ShoplingPriceAdjustmentOptionCanaryPanel/);
  for (const phrase of ["옵션 추가금 실제 변경 카나리", "최근 읽기 전용 계획 불러오기", "옵션 상태·재고·바코드·자체관리코드는 변경하지 않습니다", "option-canary\/run", "option-canary\/result"]) {
    assert.match(panel, new RegExp(phrase));
  }
  assert.match(panel, /differentOptionAmounts/);
  assert.match(runRoute, /dispatchShoplingPriceAdjustmentOptionCanary/);
  assert.match(resultRoute, /fetchShoplingPriceAdjustmentOptionCanaryResult/);
  assert.doesNotMatch(panel, /setInterval|setTimeout/);
});
