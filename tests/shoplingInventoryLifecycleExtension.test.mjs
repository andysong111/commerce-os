import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const extensionRoot = path.join(root, "public", "shopling-inventory-lifecycle");

async function source(name) {
  return readFile(path.join(extensionRoot, name), "utf8");
}

test("extension manifest is limited to Shopling and the Commerce OS bridge", async () => {
  const manifest = JSON.parse(await source("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.name, /Shopling 재고상태 전환/);
  assert.deepEqual(manifest.host_permissions.sort(), [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ].sort());
  assert.ok(!manifest.permissions.includes("debugger"));
  assert.ok(!manifest.permissions.includes("webRequest"));
});

test("option products use A6 then A22 for both stockout and selling", async () => {
  const background = await source("background.js");
  const content = await source("content-shopling.js");
  assert.match(background, /productMode === "OPTION" \? "NAVIGATE_A22"/);
  assert.match(content, /A6/);
  assert.match(content, /A22/);
  assert.match(content, /옵션자체관리코드/);
  assert.match(content, /상품옵션전송/);
  assert.match(content, /SOLD_OUT/);
  assert.match(content, /SELLING/);
});

test("single products use A6 then A21 and require the model number", async () => {
  const background = await source("background.js");
  const content = await source("content-shopling.js");
  assert.match(background, /productMode !== "SINGLE" \|\| Boolean\(normalize\(payload\?\.modelNo\)\)/);
  assert.match(content, /NAVIGATE_A21/);
  assert.match(content, /A21_MODEL_SEARCH/);
  assert.match(content, /상품판매상태송신/);
  assert.match(content, /상품수정 송신/);
});

test("one B-code job at a time is enforced and external failure is separately reported", async () => {
  const background = await source("background.js");
  assert.match(background, /SHOPLING_LIFECYCLE_JOB_ALREADY_RUNNING/);
  assert.match(background, /COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT/);
  assert.match(background, /state, stage, message, errorCode/);
  assert.match(background, /SHOPLING_LIFECYCLE_STEP_FAILED/);
});

test("Ops Center bridge and downloadable zip include every runtime file", async () => {
  const bridge = await source("content-ops.js");
  const downloadRoute = await readFile(
    path.join(
      root,
      "src",
      "app",
      "api",
      "shopling-inventory-lifecycle-extension",
      "download",
      "route.ts",
    ),
    "utf8",
  );
  for (const name of [
    "manifest.json",
    "background.js",
    "content-ops.js",
    "content-shopling.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "README.txt",
  ]) {
    assert.match(downloadRoute, new RegExp(name.replace(".", "\\.")));
  }
  assert.match(bridge, /COMMERCE_OS_SHOPLING_LIFECYCLE_RUN/);
  assert.match(bridge, /OPS_LIFECYCLE_RUN/);
  assert.match(downloadRoute, /application\/zip/);
  assert.match(downloadRoute, /new Uint8Array\(zip\)/);
});
