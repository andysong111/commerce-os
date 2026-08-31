import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-group-canary/manifest.json", import.meta.url);
const backgroundPath = new URL("../public/shopling-market-group-canary/background-root.mjs", import.meta.url);
const contentPath = new URL("../public/shopling-market-group-canary/content-group-canary.mjs", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-market-group-canary/download/route.ts", import.meta.url);
const claimRoutePath = new URL("../src/app/api/shopling-market-group-canary/claim/route.ts", import.meta.url);

test("group canary v0.2.1 is isolated and observes Shopling result subdomains", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.2.1");
  assert.equal(manifest.name, "Commerce OS Shopling Market Group Canary");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.ok(manifest.host_permissions.includes("*://*.shopling.co.kr/*"));
  assert.deepEqual(manifest.content_scripts[0].matches, ["*://*.shopling.co.kr/*"]);
  assert.equal(manifest.background.service_worker, "background-root.mjs");
});

test("group canary uses the partial-product claim endpoint and accepts one to six remaining channels", async () => {
  const background = await readFile(backgroundPath, "utf8");
  const claimRoute = await readFile(claimRoutePath, "utf8");
  assert.doesNotThrow(() => new Function(background));
  assert.match(background, /shopling-market-group-canary\/claim/);
  assert.match(background, /group-canary-v0\.2\.1/);
  assert.match(background, /canary-group-v021-/);
  assert.match(claimRoute, /\.eq\("status", "queued"\)/);
  assert.match(claimRoute, /\.eq\("market_status", "pending"\)/);
  assert.match(claimRoute, /\.eq\("launch_item_id", launchItemId\)/);
  assert.match(claimRoute, /tasks\.length > 6/);
  assert.doesNotMatch(claimRoute, /count\(\*\) = 6/);
});

test("group canary prioritizes the most recently proven partial product before a generic oldest queue", async () => {
  const claimRoute = await readFile(claimRoutePath, "utf8");
  assert.match(claimRoute, /const recentSent = await supabase/);
  assert.match(claimRoute, /\.eq\("status", "sent"\)/);
  assert.match(claimRoute, /\.eq\("market_status", "sent"\)/);
  assert.match(claimRoute, /\.order\("completed_at", \{ ascending: false, nullsFirst: false \}\)/);
  assert.match(claimRoute, /const recentPartial =/);
  assert.match(claimRoute, /queuedIdentities\.has/);
  assert.match(claimRoute, /resumedPartialProduct: Boolean\(recentPartial\)/);
});

test("group canary still requires goods key plus self-code in the same row before selection", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /rowMatchesExactIdentity/);
  assert.match(source, /goodsKeyPattern/);
  assert.match(source, /codePattern\.test\(label\) && goodsKeyPattern\.test\(label\)/);
  assert.match(source, /exact_product_identity_ambiguous/);
  assert.match(source, /상품번호\+자사상품코드 정확일치/);
});

test("group canary follows the field-tested A18 route and saved profiles dynamically", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /쇼핑몰\\s\*미등록\\s\*검색/);
  assert.match(source, /쇼핑몰\\s\*상품등록/);
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
  assert.match(source, /savedProfileSelect\(task\.profile\)/);
  assert.match(source, /쇼핑몰별 상품판매가/);
  assert.match(source, /무시하고\.\*쇼핑몰기본정보\.\*카테고리로/);
});

test("downloaded v0.2.1 verdict is restricted to the actual Shopling result page", async () => {
  const route = await readFile(downloadPath, "utf8");
  assert.match(route, /prod_a\\\\\/prod_rgst_rspt/);
  assert.match(route, /isSubmitResultPage/);
  assert.match(route, /if \(!isSubmitResultPage\(\)\) return/);
  assert.match(route, /commerceOsShoplingMarketGroupCanaryV021/);
  assert.match(route, /canary-group-v021-/);
  assert.match(route, /new Function\(rewritten\)/);
});

test("group canary arms durable lock before send and preserves no-auto-resend behavior", async () => {
  const source = await readFile(contentPath, "utf8");
  const armIndex = source.indexOf("type: ARM_MESSAGE");
  const clickIndex = source.indexOf("click(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
  assert.match(source, /성공건수/);
  assert.match(source, /실패건수/);
  assert.match(source, /submit_result_requires_manual_check/);
  assert.match(source, /outcome: "confirm_needed"/);
  assert.doesNotMatch(source, /setTimeout\([^)]*startGroupCanary/);
});

test("group canary ZIP remains Windows Explorer friendly", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /zipSync\(entries, \{ level: 0 \}\)/);
  assert.match(source, /background-root\.mjs/);
  assert.match(source, /content-group-canary\.mjs/);
  assert.match(source, /commerce-os-shopling-market-group-canary-v0\.2\.1\.zip/);
  assert.match(source, /Shopling Market Group Canary v0\.2\.1/);
});
