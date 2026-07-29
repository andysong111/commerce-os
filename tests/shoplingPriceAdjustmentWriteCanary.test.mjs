import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import ts from "typescript";

async function importRunner() {
  const sourceName = "shoplingPriceAdjustmentCanaryRunner.ts";
  const source = (await readFile(new URL(`../src/lib/${sourceName}`, import.meta.url), "utf8")).replace(
    '"fflate"',
    JSON.stringify(import.meta.resolve("fflate")),
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceName,
    reportDiagnostics: true,
  });
  const errors = output.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(errors, []);
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

const runner = await importRunner();
const validInput = {
  goods_key: "116090",
  adjustment_bps: 3000,
  expected_current_sell_price: 1100,
  expected_option_signature: "a".repeat(64),
};

test("write canary input requires exact safe snapshot fields", () => {
  assert.deepEqual(runner.validateShoplingPriceAdjustmentCanaryInput(validInput), validInput);
  assert.throws(() => runner.validateShoplingPriceAdjustmentCanaryInput({ ...validInput, extra: 1 }), /필드/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentCanaryInput({ ...validInput, goods_key: "ABC" }), /숫자/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentCanaryInput({ ...validInput, expected_current_sell_price: 0 }), /현재 판매가/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentCanaryInput({ ...validInput, expected_option_signature: "bad" }), /옵션 서명/);
});

test("dispatch uses isolated workflow, exact confirmation and request id", () => {
  const previous = {
    repo: process.env.SHOPLING_PRICE_MODIFY_REPO,
    ref: process.env.SHOPLING_PRICE_MODIFY_REF,
    token: process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN,
  };
  process.env.SHOPLING_PRICE_MODIFY_REPO = "owner/repo";
  process.env.SHOPLING_PRICE_MODIFY_REF = "main";
  process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN = "token";
  try {
    const request = runner.buildShoplingPriceAdjustmentCanaryDispatch(validInput);
    assert.match(request.requestId, /^price-adjust-canary-/);
    assert.match(request.url, /shopling-price-adjustment-canary\.yml\/dispatches/);
    assert.equal(request.body.inputs.confirmation_text, "CONFIRM_SINGLE_PRICE_ADJUSTMENT_CANARY");
    assert.deepEqual(JSON.parse(request.body.inputs.canary_json), validInput);
    assert.equal(request.body.ref, "main");
  } finally {
    if (previous.repo === undefined) delete process.env.SHOPLING_PRICE_MODIFY_REPO; else process.env.SHOPLING_PRICE_MODIFY_REPO = previous.repo;
    if (previous.ref === undefined) delete process.env.SHOPLING_PRICE_MODIFY_REF; else process.env.SHOPLING_PRICE_MODIFY_REF = previous.ref;
    if (previous.token === undefined) delete process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN; else process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN = previous.token;
  }
});

test("artifact extraction accepts the isolated canary summary", () => {
  const summary = { request_id: "price-adjust-canary-20260729T120000Z-abcdef", status: "success", goods_key: "116090" };
  const zip = zipSync({
    "output/github_actions/price_adjustment_canary_summary.json": strToU8(JSON.stringify(summary)),
  });
  assert.deepEqual(runner.extractShoplingPriceAdjustmentCanarySummary(zip), summary);
});

test("UI exposes one-product write only after readonly plan and blocks option changes", async () => {
  const ui = await readFile(new URL("../src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx", import.meta.url), "utf8");
  const runRoute = await readFile(new URL("../src/app/api/shopling-price-adjustment/canary/run/route.ts", import.meta.url), "utf8");
  const resultRoute = await readFile(new URL("../src/app/api/shopling-price-adjustment/canary/result/route.ts", import.meta.url), "utf8");
  for (const phrase of [
    "단일 상품 실제 가격 변경 카나리",
    "이 1개 실제 가격 변경 테스트",
    "실제 변경 결과 가져오기",
    "옵션 추가금 변경이 필요한 상품",
    "24개 쇼핑몰 가격정책",
    "sameNumberArray",
    "expected_option_signature",
  ]) assert.match(ui, new RegExp(phrase));
  assert.match(ui, /\/api\/shopling-price-adjustment\/canary\/run/);
  assert.match(ui, /\/api\/shopling-price-adjustment\/canary\/result/);
  assert.match(runRoute, /dispatchShoplingPriceAdjustmentCanary/);
  assert.match(resultRoute, /fetchShoplingPriceAdjustmentCanaryResult/);
  assert.doesNotMatch(ui, /옵션 추가금.*실제 반영/);
});
