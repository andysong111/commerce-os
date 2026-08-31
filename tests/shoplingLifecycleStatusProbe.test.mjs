import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL(
  "../src/app/api/shopling-lifecycle-status-probe/route.ts",
  import.meta.url,
);

test("lifecycle status probe reads sale_status without any Shopling write path", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /sale_status/);
  assert.match(source, /buildShoplingProductIdLookupXml/);
  assert.match(source, /parseShoplingReadResponse\("products"/);
  assert.match(source, /writesEnabled:\s*false/);
  assert.match(source, /MAX_GOODS_KEYS = 50/);
  assert.doesNotMatch(source, /status_chg\s*\(/);
  assert.doesNotMatch(source, /del_submit\s*\(/);
  assert.doesNotMatch(source, /\.from\(/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
});

test("lifecycle status probe validates numeric goods keys and keeps response no-store", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /const GOODS_KEY = \/\^\\d\+\$\//);
  assert.match(source, /invalid_goods_keys/);
  assert.match(source, /cache-control.*no-store/s);
  assert.match(source, /x-content-type-options/);
});

test("GET diagnostics are preview-only while production automation remains POST", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /export async function POST/);
  assert.match(source, /export async function GET/);
  assert.match(source, /process\.env\.VERCEL_ENV !== "preview"/);
  assert.match(source, /preview_probe_only/);
  assert.match(source, /status:\s*405/);
});
