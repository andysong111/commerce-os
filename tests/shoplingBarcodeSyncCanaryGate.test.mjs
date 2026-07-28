import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  SHOPLING_BARCODE_SYNC_CANARY_COOKIE,
  SHOPLING_BARCODE_SYNC_CANARY_GATE_KEYS,
  evaluateShoplingBarcodeSyncCanary,
} = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingBarcodeSyncCanaryGate.ts", import.meta.url),
);
const { SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingBarcodeSyncRunner.ts", import.meta.url),
);

const verifiedKeys = [
  "117305",
  "117308",
  "117311",
  "100049",
  "100034",
  "102648",
  "110791",
  "116737",
  "109791",
  "121102",
];

function validResult(overrides = {}) {
  return {
    status: "success",
    runConclusion: "success",
    summary: {
      request_id: "barcode-sync-20260728T090000Z-abcdef",
      mode: "canary",
      generated_at: "2026-07-28T09:05:00.000Z",
      requested_goods_keys: verifiedKeys,
      collection_errors: [],
      blocked_products: 0,
      execution: {
        selected_products: 10,
        attempted_products: 10,
        success: 10,
        failed: 0,
        unknown: 0,
        skipped: 0,
        stopped_early: false,
      },
    },
    ...overrides,
  };
}

test("engine dispatch and server gate use the same exact ten canary keys", () => {
  assert.deepEqual([...SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS], verifiedKeys);
  assert.deepEqual([...SHOPLING_BARCODE_SYNC_CANARY_GATE_KEYS], verifiedKeys);
  assert.equal(SHOPLING_BARCODE_SYNC_CANARY_COOKIE, "shopling_barcode_sync_canary");
});

test("ten successful verified canary products open the bulk gate", () => {
  const gate = evaluateShoplingBarcodeSyncCanary(
    validResult(),
    new Date("2026-07-28T10:00:00Z"),
  );
  assert.deepEqual(gate, {
    ok: true,
    message: "검증된 10개 테스트가 모두 성공했습니다.",
  });
});

test("non-canary and mismatched verified keys are rejected", () => {
  const plan = validResult();
  plan.summary.mode = "plan";
  assert.equal(
    evaluateShoplingBarcodeSyncCanary(plan, new Date("2026-07-28T10:00:00Z")).ok,
    false,
  );

  const wrongKeys = validResult();
  wrongKeys.summary.requested_goods_keys = [...verifiedKeys].reverse();
  assert.equal(
    evaluateShoplingBarcodeSyncCanary(wrongKeys, new Date("2026-07-28T10:00:00Z")).ok,
    false,
  );
});

test("partial, failed, unknown, stopped, or stale canary results are rejected", () => {
  for (const executionPatch of [
    { success: 9, failed: 1 },
    { unknown: 1, success: 9 },
    { skipped: 1, success: 9 },
    { stopped_early: true },
    { selected_products: 9, attempted_products: 9, success: 9 },
  ]) {
    const result = validResult();
    Object.assign(result.summary.execution, executionPatch);
    assert.equal(
      evaluateShoplingBarcodeSyncCanary(result, new Date("2026-07-28T10:00:00Z")).ok,
      false,
    );
  }

  const stale = validResult();
  assert.equal(
    evaluateShoplingBarcodeSyncCanary(stale, new Date("2026-08-05T10:00:00Z")).ok,
    false,
  );
});

test("result verification issues an HttpOnly strict canary proof cookie", async () => {
  const source = await readFile(
    new URL("../src/app/api/shopling-barcode-sync/result/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /evaluateShoplingBarcodeSyncCanary/);
  assert.match(source, /response\.cookies\.set\(SHOPLING_BARCODE_SYNC_CANARY_COOKIE/);
  assert.match(source, /httpOnly:\s*true/);
  assert.match(source, /sameSite:\s*"strict"/);
  assert.match(source, /maxAge:\s*7 \* 24 \* 60 \* 60/);
});

test("run route revalidates the cookie proof before apply dispatch", async () => {
  const source = await readFile(
    new URL("../src/app/api/shopling-barcode-sync/run/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /mode === "apply"/);
  assert.match(source, /SHOPLING_BARCODE_SYNC_CANARY_COOKIE/);
  assert.match(source, /cookieStore\.get/);
  assert.match(source, /fetchShoplingBarcodeSyncActionsResult/);
  assert.match(source, /evaluateShoplingBarcodeSyncCanary/);
  assert.match(source, /status:\s*409/);
});
