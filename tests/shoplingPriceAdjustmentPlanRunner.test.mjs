import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const runner = await importTranspiledTypeScript(new URL("../src/lib/shoplingPriceAdjustmentPlanRunner.ts", import.meta.url));
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function withConfig(callback) {
  const previous = {
    repo: process.env.SHOPLING_PRICE_MODIFY_REPO,
    workflow: process.env.SHOPLING_PRICE_ADJUSTMENT_PLAN_WORKFLOW,
    ref: process.env.SHOPLING_PRICE_MODIFY_REF,
    token: process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN,
  };
  process.env.SHOPLING_PRICE_MODIFY_REPO = "andysong111/shopling-price-modify-auto";
  process.env.SHOPLING_PRICE_ADJUSTMENT_PLAN_WORKFLOW = "shopling-price-adjustment-plan.yml";
  process.env.SHOPLING_PRICE_MODIFY_REF = "main";
  process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN = "test-token";
  try { return callback(); }
  finally {
    for (const [key, value] of Object.entries({
      SHOPLING_PRICE_MODIFY_REPO: previous.repo,
      SHOPLING_PRICE_ADJUSTMENT_PLAN_WORKFLOW: previous.workflow,
      SHOPLING_PRICE_MODIFY_REF: previous.ref,
      SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN: previous.token,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("validates exact rows, range, duplicates and 50-row boundary", () => {
  assert.deepEqual(runner.validateShoplingPriceAdjustmentPlanRows([
    { goods_key: "119836", adjustment_bps: 1000 },
    { goods_key: "119837", adjustment_bps: -500 },
  ]), [
    { goods_key: "119836", adjustment_bps: 1000 },
    { goods_key: "119837", adjustment_bps: -500 },
  ]);
  assert.throws(() => runner.validateShoplingPriceAdjustmentPlanRows([]), /상품이 없습니다/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentPlanRows([{ goods_key: "ABC", adjustment_bps: 100 }]), /숫자만/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentPlanRows([{ goods_key: "1", adjustment_bps: -10000 }]), /허용 범위/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentPlanRows([{ goods_key: "1", adjustment_bps: 1 }, { goods_key: "1", adjustment_bps: 1 }]), /중복/);
  assert.throws(() => runner.validateShoplingPriceAdjustmentPlanRows(Array.from({ length: 51 }, (_, index) => ({ goods_key: String(index), adjustment_bps: 100 }))), /최대 50개/);
});

test("dispatch request targets the separate read-only workflow and serializes integer plans", () => withConfig(() => {
  const request = runner.buildShoplingPriceAdjustmentPlanDispatch([
    { goods_key: "119836", adjustment_bps: 1000 },
  ]);
  assert.match(request.requestId, /^price-adjust-plan-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
  assert.match(request.url, /shopling-price-adjustment-plan\.yml\/dispatches$/);
  assert.equal(request.body.ref, "main");
  assert.deepEqual(JSON.parse(request.body.inputs.adjustment_plan_json), [{ goods_key: "119836", adjustment_bps: 1000 }]);
  assert.equal(request.body.inputs.request_id, request.requestId);
  assert.ok(!JSON.stringify(request.body).includes("test-token"));
}));

test("request timestamp parser recognizes generated IDs", () => {
  const id = runner.generateShoplingPriceAdjustmentPlanRequestId(new Date("2026-07-29T10:20:30.000Z"));
  assert.match(id, /^price-adjust-plan-20260729T102030Z-/);
  assert.equal(runner.parseShoplingPriceAdjustmentPlanRequestDate(id)?.toISOString(), "2026-07-29T10:20:30.000Z");
  assert.equal(runner.parseShoplingPriceAdjustmentPlanRequestDate("bad"), null);
});

test("extracts the exact read-only plan artifact", () => {
  const summary = {
    request_id: "price-adjust-plan-20260729T102030Z-a1b2c3",
    status: "success",
    planned_goods_key_count: 1,
    rows: [{ goods_key: "119836", current: { sell_price: 10000 }, target: { sell_price: 11000 } }],
  };
  const zip = zipSync({
    "output/github_actions/price_adjustment_plan_summary.json": strToU8(JSON.stringify(summary)),
  });
  assert.deepEqual(runner.extractShoplingPriceAdjustmentPlanSummary(zip), summary);
  assert.throws(() => runner.extractShoplingPriceAdjustmentPlanSummary(zipSync({ "other.json": strToU8("{}") })), /summary를 찾을 수 없습니다/);
});

test("API routes and UI expose only the first-10 read-only canary", async () => {
  const [runRoute, resultRoute, component] = await Promise.all([
    read("src/app/api/shopling-price-adjustment/plan/run/route.ts"),
    read("src/app/api/shopling-price-adjustment/plan/result/route.ts"),
    read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx"),
  ]);
  assert.match(runRoute, /dispatchShoplingPriceAdjustmentPlan/);
  assert.match(resultRoute, /fetchShoplingPriceAdjustmentPlanResult/);
  assert.match(component, /slice\(0, 10\)/);
  assert.match(component, /공식 API 현재가·옵션 읽기 전용 카나리/);
  assert.match(component, /가격 수정 API는 호출하지 않습니다/);
  assert.match(component, /\/api\/shopling-price-adjustment\/plan\/run/);
  assert.match(component, /\/api\/shopling-price-adjustment\/plan\/result/);
  assert.doesNotMatch(runRoute + resultRoute, /shopling-price-modify\/run/);
});

test("runner is bounded to workflow dispatch and artifact reads, not Shopling writes", async () => {
  const source = await read("src/lib/shoplingPriceAdjustmentPlanRunner.ts");
  assert.match(source, /shopling-price-adjustment-plan\.yml/);
  assert.match(source, /shopling-price-adjustment-plan-summary/);
  assert.doesNotMatch(source, /prod_modify_api|prod_each_mall_modify_api|apiProdMdy|apiProdEachMdy/);
  assert.doesNotMatch(source, /SHOPLING_SESSION_COOKIE|SHOPLING_COOKIE/);
});
