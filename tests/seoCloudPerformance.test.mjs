import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(path, "utf8");
}

test("SEO cloud avoids permanent polling and whole-page DOM observers", async () => {
  const [controlPanel, identityBridge, launchHandoff, trackerHandoff, trackerPage] =
    await Promise.all([
      read("src/app/keyword-engine-elon-lab/SeoTitleLedgerControlPanel.tsx"),
      read("src/app/keyword-engine-elon-lab/SeoTitleLedgerPageIdentityBridge.tsx"),
      read("src/app/keyword-engine-elon-lab/SeoTitleLedgerLaunchHandoff.tsx"),
      read("public/product-launch-tracker-app/seo-title-ledger-handoff.js"),
      read("src/app/product-launch-tracker/page.tsx"),
    ]);

  assert.doesNotMatch(controlPanel, /setInterval\s*\(/);
  assert.match(controlPanel, /SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT/);
  assert.match(controlPanel, /limit:\s*"5"/);
  assert.doesNotMatch(controlPanel, /limit=200/);

  assert.doesNotMatch(identityBridge, /MutationObserver/);
  assert.match(identityBridge, /requestAnimationFrame/);

  assert.match(launchHandoff, /SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT/);
  assert.match(launchHandoff, /dispatchEvent/);

  assert.doesNotMatch(trackerHandoff, /MutationObserver/);
  assert.match(trackerHandoff, /MAX_INSTALL_ATTEMPTS/);
  assert.match(trackerHandoff, /handleSelectionChange/);

  assert.match(trackerPage, /seo-bulk-cloud-v3-perf/);
});
