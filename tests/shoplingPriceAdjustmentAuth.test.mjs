import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const operatorRoutes = [
  "src/app/api/shopling-price-adjustment/batch-canary/result/route.ts",
  "src/app/api/shopling-price-adjustment/batch-canary/run/route.ts",
  "src/app/api/shopling-price-adjustment/canary/result/route.ts",
  "src/app/api/shopling-price-adjustment/canary/run/route.ts",
  "src/app/api/shopling-price-adjustment/option-canary/result/route.ts",
  "src/app/api/shopling-price-adjustment/option-canary/run/route.ts",
  "src/app/api/shopling-price-adjustment/plan/result/route.ts",
  "src/app/api/shopling-price-adjustment/plan/run/route.ts",
];

const adminRoutes = [
  "src/app/api/shopling-price-adjustment/bulk/jobs/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/advance/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/pause/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/start/route.ts",
];

const clientComponents = [
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx",
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx",
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentOptionCanaryPanel.tsx",
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentUnifiedCanaryPanel.tsx",
];

test("every price-adjustment API route requires an allowed operator", async () => {
  for (const path of operatorRoutes) {
    const source = await read(path);
    assert.match(source, /requireShoplingPriceAdjustmentOperator\(request\)/, path);
    assert.match(source, /if \(!auth\.ok\) return auth\.response/, path);
  }
  for (const path of adminRoutes) {
    const source = await read(path);
    assert.match(source, /requireShoplingPriceAdjustmentAdmin\(request\)/, path);
    assert.match(source, /if \(!auth\.ok\) return auth\.response/, path);
  }
});

test("operator auth validates bearer tokens server-side and enforces an email allowlist", async () => {
  const source = await read("src/lib/shoplingPriceAdjustmentAuth.ts");

  assert.match(source, /supabase\.auth\.getUser\(bearer\.token\)/);
  assert.match(source, /shoplingPriceAdjustmentOperatorEmails/);
  assert.match(source, /SHOPLING_PRICE_ADJUSTMENT_ALLOWED_EMAILS/);
  assert.match(source, /OPS_OWNER_EMAILS/);
  assert.match(source, /PRICE_ADJUSTMENT_OPERATOR_REQUIRED/);
  assert.match(source, /status \},/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SECRET_KEY/);
});

test("browser auth tokens stay inside the same-origin price-adjustment API boundary", async () => {
  const source = await read("src/lib/shoplingPriceAdjustmentApiClient.ts");

  assert.match(source, /target\.origin !== origin/);
  assert.match(source, /target\.pathname\.startsWith\(SHOPLING_PRICE_ADJUSTMENT_API_PREFIX\)/);
  assert.match(source, /headers\.set\([\s\S]*"authorization"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT/);
});

test("all price-adjustment UI requests use the guarded API client", async () => {
  for (const path of clientComponents) {
    const source = await read(path);
    assert.match(source, /requestShoplingPriceAdjustmentApi/, path);
    assert.doesNotMatch(source, /\bfetch\s*\(/, path);
  }
});

test("a stale page session can force one password reauthentication without losing bulk input", async () => {
  const batch = await read(clientComponents[0]);
  const login = await read("src/app/login/page.tsx");
  const storage = await read(
    "src/lib/shoplingPriceAdjustmentBulkSelection.ts",
  );

  assert.match(batch, /force=1/);
  assert.match(batch, /SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT/);
  assert.match(batch, /로그인 다시 하기/);
  assert.match(login, /params\.force !== "1"/);
  assert.match(storage, /shoplingPriceAdjustment\.currentBulkSelection/);
});
