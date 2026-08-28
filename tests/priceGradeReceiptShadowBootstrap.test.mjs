import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bootstrap, cron, scheduler] = await Promise.all([
  readFile("src/lib/priceGradeReceiptShadowBootstrap.ts", "utf8"),
  readFile(
    "src/app/api/cron/price-grade-receipt-shadow-bootstrap/route.ts",
    "utf8",
  ),
  readFile("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql", "utf8"),
]);

test("bootstrap reuses only a result whose receipt-augmented content fingerprint is current", () => {
  assert.match(bootstrap, /receipt-cache-fallback-v1/);
  assert.match(bootstrap, /loadLatestPriceGradeShadowComparison/);
  assert.match(bootstrap, /loadPriceGradeReceiptAugmentedSnapshot/);
  assert.match(bootstrap, /hasCurrentReceiptEvidence\(latest\)/);
  assert.match(
    bootstrap,
    /latest\.contentFingerprint === current\.snapshot\.contentFingerprint/,
  );
  assert.match(bootstrap, /reason: "ALREADY_BOOTSTRAPPED"/);
  assert.match(bootstrap, /runPriceGradeShadowComparisonWithReceiptCache/);
  assert.match(bootstrap, /reason: "BOOTSTRAPPED"/);
  assert.ok(
    bootstrap.indexOf("latest.contentFingerprint ===") <
      bootstrap.indexOf("runPriceGradeShadowComparisonWithReceiptCache()"),
  );
});

test("bootstrap result exposes only read-only summary counts", () => {
  assert.match(bootstrap, /writesEnabled: false/);
  assert.match(bootstrap, /blockedCount/);
  assert.match(bootstrap, /unexplainedCount/);
  assert.match(bootstrap, /fallbackProductCount/);
  assert.match(bootstrap, /remainingWithoutReceiptCount/);
  assert.doesNotMatch(
    bootstrap,
    /shopling.*(?:modify|update|write)|inventory.*(?:modify|update|write)|1688/i,
  );
});

test("cron is bearer protected, read-only, and an operational dispatcher task", () => {
  assert.match(cron, /Bearer \$\{expected\}/);
  assert.match(cron, /runPriceGradeReceiptShadowBootstrap/);
  assert.match(cron, /maxDuration = 120/);
  assert.match(cron, /writesEnabled: false/);
  assert.match(
    scheduler,
    /'price-grade-receipt-shadow-bootstrap', '\/api\/cron\/price-grade-receipt-shadow-bootstrap', 'operational', 150, true, 3600, 300, 21600/,
  );
});
