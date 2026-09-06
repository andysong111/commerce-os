import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorker } from "../scripts/build-shopling-stock-worker-v023.mjs";
import "./shoplingStockStateV023Behavior.test.mjs";
const root = "public/shopling-stock-state-sync";
test("v0.2.3 manifest uses admin-source workers without debugger", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3); assert.equal(m.version, "0.2.3");
  assert.equal(m.background.service_worker, "background-launch-v023.js");
  assert.ok(!m.permissions.includes("debugger"));
  assert.ok(m.content_scripts.some((s) => s.js.includes("content-shopling-v023.js") && s.all_frames));
});
test("all packaged and generated JS parses", async () => {
  for (const name of ["background-v020.js", "background-v023.js", "background-launch-v023.js", "content-ops-v021.js", "main-shopling.js", "popup.js"]) {
    const src = await readFile(`${root}/${name}`, "utf8"); assert.doesNotThrow(() => new Function(src));
  }
  const built = buildStockWorker(await readFile(`${root}/content-shopling-v018.js`, "utf8"), await readFile(`${root}/search-policy-v023.js`, "utf8"));
  assert.doesNotThrow(() => new Function(built));
});
test("source tab is preserved; the price pattern creates separate windows", async () => {
  const b = await readFile(`${root}/background-v023.js`, "utf8");
  assert.match(b, /chrome\.windows\.create/); assert.match(b, /allFrames: true/); assert.match(b, /world: "MAIN"/);
  assert.doesNotMatch(b, /chrome\.tabs\.reload/); assert.doesNotMatch(b, /chrome\.tabs\.update/);
  assert.match(b, /baselineTabIds/); assert.match(b, /relatedTab/);
});
test("OPS version comes from installed manifest and retains terminal-state recovery", async () => {
  const b = await readFile(`${root}/content-ops-v021.js`, "utf8");
  assert.match(b, /chrome\.runtime\.getManifest\(\)\.version/); assert.match(b, /staleTerminalRunning/); assert.match(b, /lastFinishedAt >= activeStartedAt/);
});
