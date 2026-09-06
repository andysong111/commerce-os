import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.3.0 manifest uses price-engine style all-frame workspace", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3); assert.equal(m.version, "0.3.0");
  assert.equal(m.background.service_worker, "background-v030.js");
  const shopling = m.content_scripts.find((s) => s.js.includes("content-shopling-v030.js"));
  assert.ok(shopling?.all_frames);
});

test("all packaged and generated JS parses", async () => {
  for (const name of ["background-v020.js", "background-v030.js", "content-ops-v021.js", "main-shopling.js", "popup.js"]) {
    const src = await readFile(`${root}/${name}`, "utf8"); assert.doesNotThrow(() => new Function(src));
  }
  const built = buildStockWorkerV030(await readFile(`${root}/content-shopling-v018.js`, "utf8"), await readFile(`${root}/search-policy-v023.js`, "utf8"));
  assert.doesNotThrow(() => new Function(built));
  assert.match(built, /const VERSION = "0\.3\.0"/);
  assert.match(built, /selectWithOption\("옵션자체관리코드"\)\.length/);
});

test("background directly scans all frames and owns isolated work windows", async () => {
  const b = await readFile(`${root}/background-v030.js`, "utf8");
  assert.match(b, /allFrames: true/);
  assert.match(b, /chrome\.windows\.create/);
  assert.match(b, /frameId/);
  assert.match(b, /옵션자체관리코드/);
  assert.match(b, /샵플링상품코드/);
  assert.match(b, /frame 진단/);
  assert.doesNotMatch(b, /chrome\.tabs\.reload/);
});

test("OPS bridge still reports installed manifest version and terminal recovery", async () => {
  const b = await readFile(`${root}/content-ops-v021.js`, "utf8");
  assert.match(b, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(b, /staleTerminalRunning/);
  assert.match(b, /lastFinishedAt >= activeStartedAt/);
});
