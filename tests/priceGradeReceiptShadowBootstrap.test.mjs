import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bootstrap, cron, vercel] = await Promise.all([
  readFile("src/lib/priceGradeReceiptShadowBootstrap.ts", "utf8"),
  readFile(
    "src/app/api/cron/price-grade-receipt-shadow-bootstrap/route.ts",
    "utf8",
  ),
  readFile("vercel.json", "utf8").then(JSON.parse),
]);

test("bootstrap runs the receipt-cache comparison only when the current evidence is absent", () => {
  assert.match(bootstrap, /receipt-cache-fallback-v1/);
  assert.match(bootstrap, /loadLatestPriceGradeShadowComparison/);
  assert.match(bootstrap, /hasCurrentReceiptEvidence\(latest\)/);
  assert.match(bootstrap, /reason: "ALREADY_BOOTSTRAPPED"/);
  assert.match(bootstrap, /runPriceGradeShadowComparisonWithReceiptCache/);
  assert.match(bootstrap, /reason: "BOOTSTRAPPED"/);
  assert.ok(
    bootstrap.indexOf("hasCurrentReceiptEvidence(latest)") <
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

test("cron is bearer protected and scheduled every five minutes", () => {
  assert.match(cron, /Bearer \$\{expected\}/);
  assert.match(cron, /runPriceGradeReceiptShadowBootstrap/);
  assert.match(cron, /maxDuration = 120/);
  assert.match(cron, /writesEnabled: false/);
  assert.ok(
    vercel.crons.some(
      (entry) =>
        entry.path === "/api/cron/price-grade-receipt-shadow-bootstrap" &&
        entry.schedule === "*/5 * * * *",
    ),
  );
});
