import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL(
  "../src/app/api/shopling-lifecycle-status-probe/route.ts",
  import.meta.url,
);
const readerPath = new URL(
  "../src/lib/shopling/shoplingLifecycleStatus.ts",
  import.meta.url,
);

test("lifecycle status reader reads sale_status without any Shopling write path", async () => {
  const route = await readFile(routePath, "utf8");
  const reader = await readFile(readerPath, "utf8");
  assert.match(route, /loadShoplingLifecycleStatusSnapshot/);
  assert.match(reader, /sale_status/);
  assert.match(reader, /buildShoplingProductIdLookupXml/);
  assert.match(reader, /parseShoplingReadResponse\("products"/);
  assert.match(reader, /writesEnabled:\s*false/);
  assert.match(reader, /const GOODS_KEY = \/\^\\d\+\$\//);
  assert.match(reader, /canonicalShoplingSaleStatus/);
  assert.match(reader, /"B", "SELLING", "판매중"/);
  assert.match(reader, /"C", "SOLD_OUT", "SOLDOUT", "품절"/);
  assert.doesNotMatch(`${route}\n${reader}`, /status_chg\s*\(/);
  assert.doesNotMatch(`${route}\n${reader}`, /del_submit\s*\(/);
  assert.doesNotMatch(`${route}\n${reader}`, /\.from\(/);
  assert.doesNotMatch(`${route}\n${reader}`, /\.insert\(|\.update\(|\.delete\(/);
});

test("lifecycle status probe limits goods keys and keeps response no-store", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /MAX_GOODS_KEYS = 50/);
  assert.match(source, /invalid_goods_keys/);
  assert.match(source, /normalizeLifecycleGoodsKeys/);
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
