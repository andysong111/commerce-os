import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [connection, nextConfig, dock] = await Promise.all([
  readFile("src/lib/detailPageStudioConnection.ts", "utf8"),
  readFile("next.config.ts", "utf8"),
  readFile("public/product-launch-tracker-app/detail-page-dock.js", "utf8"),
]);

const OPS_V260807_HOST = "commerce-os-detail-page-studio-pzxe.vercel.app";

test("product launch tracker is pinned to the dedicated OPS v260807 Production Studio", () => {
  assert.match(connection, /OPS_CENTER_V260807_STUDIO_URL/);
  assert.ok(connection.includes(OPS_V260807_HOST));
  assert.match(
    connection,
    /isPreview \|\| isProduction[\s\S]*OPS_CENTER_V260807_STUDIO_URL/,
  );
  assert.ok(nextConfig.includes(OPS_V260807_HOST));
  assert.doesNotMatch(
    connection,
    /OPS_CENTER_V260807_STUDIO_URL\s*=\s*[\s\S]*git-isolated-op-4a07df/,
  );
});

test("selected product launch rows force 1688 link mode and pass seller options", () => {
  assert.match(dock, /url\.searchParams\.set\("ops_dock", "1"\)/);
  assert.match(dock, /url\.searchParams\.set\("source_url", job\.sourceUrl\)/);
  assert.match(
    dock,
    /if \(job\.salesOptions\) url\.searchParams\.set\("sales_options", job\.salesOptions\)/,
  );
  assert.match(dock, /Array\.isArray\(item\?\.orderOptions\)/);
  assert.match(dock, /option\?\.saleOption/);
});

test("completed detail-page assets dock back to product launch detail fields", () => {
  assert.match(dock, /detailPageAsset:/);
  assert.match(dock, /detailImageUrl,/);
  assert.match(dock, /mainImageUrl,/);
  assert.match(dock, /additionalImageUrls,/);
  assert.match(dock, /html: detailHtml/);
  assert.match(dock, /status: "completed"/);
  assert.match(dock, /stage: "docked"/);
});
