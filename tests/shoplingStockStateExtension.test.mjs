import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";
const jsFiles = [
  "background.js",
  "content-ops.js",
  "main-shopling.js",
  "content-shopling.js",
  "popup.js",
];

test("stock state extension is Manifest V3 and intentionally excludes debugger permission", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(!manifest.permissions.includes("debugger"));
  assert.ok(
    manifest.content_scripts.some(
      (entry) => entry.world === "MAIN" && entry.js.includes("main-shopling.js"),
    ),
  );
});

test("all shipped extension JavaScript parses before ZIP download", async () => {
  for (const fileName of jsFiles) {
    const source = await readFile(`${root}/${fileName}`, "utf8");
    assert.doesNotThrow(() => new Function(source), fileName);
  }
});

test("option and single products use different propagation routes", async () => {
  const background = await readFile(`${root}/background.js`, "utf8");
  const shopling = await readFile(`${root}/content-shopling.js`, "utf8");
  const readme = await readFile(`${root}/README.txt`, "utf8");

  assert.match(background, /productKind === "OPTION" \? "A22" : "A21_LIST"/);
  assert.match(shopling, /runA6/);
  assert.match(shopling, /runA22/);
  assert.match(shopling, /runA21List/);
  assert.match(shopling, /runA21Popup/);
  assert.match(shopling, /옵션자체관리코드/);
  assert.match(shopling, /상품판매상태송신/);
  assert.match(readme, /단품은 A22 옵션전송만으로 품절\/판매중을 확정하지 않습니다/);
});

test("extension blocks opposite concurrent states and never treats timeout as success", async () => {
  const background = await readFile(`${root}/background.js`, "utf8");
  assert.match(background, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
  assert.match(background, /이미 실행 중이라 중복·경합을 차단/);
  assert.match(background, /submitted \? "UNCERTAIN" : "FAILED"/);
  assert.match(background, /failureCount/);
  assert.doesNotMatch(background, /RESULT_TIMEOUT[\s\S]{0,180}SUCCEEDED/);
});

test("extension requires exact B-code or model-number rows before write", async () => {
  const shopling = await readFile(`${root}/content-shopling.js`, "utf8");
  assert.match(shopling, /exactTokenRegex/);
  assert.match(shopling, /selectOnlyMatchingRows/);
  assert.match(shopling, /A6_EXACT_ROW_SELECTION_FAILED/);
  assert.match(shopling, /A21_EXACT_ROW_SELECTION_FAILED/);
  assert.match(shopling, /A22_EXACT_ROW_SELECTION_FAILED/);
});

test("download route packages only the reviewed stock-state extension files", async () => {
  const route = await readFile(
    "src/app/api/shopling-stock-state-sync/download/route.ts",
    "utf8",
  );
  for (const fileName of ["manifest.json", ...jsFiles, "popup.html", "README.txt"]) {
    assert.match(route, new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(route, /shopling_stock_state_debugger_forbidden/);
  assert.match(route, /content-type": "application\/zip/);
});
