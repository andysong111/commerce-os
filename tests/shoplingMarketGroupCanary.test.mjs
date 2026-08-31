import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-group-canary/manifest.json", import.meta.url);
const backgroundPath = new URL("../public/shopling-market-group-canary/background-root.mjs", import.meta.url);
const contentPath = new URL("../public/shopling-market-group-canary/content-group-canary.mjs", import.meta.url);
const routePath = new URL("../src/app/api/shopling-market-group-canary/download/route.ts", import.meta.url);

test("group canary v0.2.0 is isolated and observes Shopling result subdomains", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.name, "Commerce OS Shopling Market Group Canary");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.ok(manifest.host_permissions.includes("*://*.shopling.co.kr/*"));
  assert.deepEqual(manifest.content_scripts[0].matches, ["*://*.shopling.co.kr/*"]);
  assert.equal(manifest.background.service_worker, "background-root.mjs");
});

test("group canary scripts are syntactically valid and claim only one product group", async () => {
  const background = await readFile(backgroundPath, "utf8");
  const content = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(background));
  assert.doesNotThrow(() => new Function(content));
  assert.match(background, /action: "claim", runId, groupLimit: 1/);
  assert.match(background, /tasks\.length <= 6/);
  assert.match(background, /launchIds\.size <= 1/);
  assert.match(background, /canary-group-v020-/);
});

test("group canary requires goods key plus self-code in the same row before selection", async () => {
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

test("group canary arms durable lock before send and only confirms sent from result evidence", async () => {
  const source = await readFile(contentPath, "utf8");
  const armIndex = source.indexOf("type: ARM_MESSAGE");
  const clickIndex = source.indexOf("click(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
  assert.match(source, /성공건수/);
  assert.match(source, /실패건수/);
  assert.match(source, /if \(isProductListUi\(\) \|\| isIdChoicePage\(\) \|\| isPreProdChoicePage\(\)\) return/);
  assert.match(source, /submit_result_requires_manual_check/);
});

test("group canary releases pre-submit current and unstarted rows and never auto-retries after submit", async () => {
  const source = await readFile(contentPath, "utf8");
  const background = await readFile(backgroundPath, "utf8");
  assert.match(source, /group_canary_aborted_unstarted/);
  assert.match(source, /outcome: "failed"/);
  assert.match(source, /outcome: "confirm_needed"/);
  assert.match(background, /action: "report"/);
  assert.doesNotMatch(source, /setTimeout\([^)]*startGroupCanary/);
});

test("group canary ZIP is Windows Explorer friendly", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /zipSync\(entries, \{ level: 0 \}\)/);
  assert.match(source, /background-root\.mjs/);
  assert.match(source, /content-group-canary\.mjs/);
  assert.match(source, /commerce-os-shopling-market-group-canary-v0\.2\.0\.zip/);
  assert.match(source, /Shopling Market Group Canary v0\.2\.0/);
});
