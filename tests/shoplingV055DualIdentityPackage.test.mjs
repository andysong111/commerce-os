import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const downloadRoutePath = new URL("../src/app/api/shopling-account-title-bridge/download/route.ts", import.meta.url);

test("Shopling v0.5.5 downloadable package requires goods key plus self-code exact identity", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.match(source, /manifest\.version = "0\.5\.5"/);
  assert.match(source, /rowMatchesExactIdentity/);
  assert.match(source, /context\?\.goodsKey/);
  assert.match(source, /goodsKeyPattern/);
  assert.match(source, /exact_product_identity_ambiguous/);
  assert.match(source, /상품번호/);
  assert.match(source, /다른 상품을 건드리지 않고 중단/);
  assert.match(source, /\.replace\(LEGACY_IDENTITY_MATCH, DUAL_IDENTITY_MATCH\)/);
  assert.match(source, /shopling_v055_identity_rewrite_failed/);
});

test("Shopling v0.5.5 package carries the field-verified category mapping controls", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.match(source, /매핑된 카테고리로 전송/);
  assert.match(source, /무시하고\.\*쇼핑몰기본정보\.\*카테고리로/);
  assert.match(source, /commerce-os-shopling-account-title-bridge-v0\.5\.5\.zip/);
  assert.match(source, /Commerce OS Shopling Account Title Bridge v0\.5\.5/);
});
