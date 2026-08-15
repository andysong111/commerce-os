import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [configRoute, dockSource] = await Promise.all([
  readFile(
    "src/app/api/product-launch-tracker/detail-page-engine-config/route.ts",
    "utf8",
  ),
  readFile("public/product-launch-tracker-app/detail-page-dock.js", "utf8"),
]);

test("normal product-launch config lookup does not synchronously block on Studio probes", () => {
  assert.match(
    configRoute,
    /const diagnosticProbe = request\.nextUrl\.searchParams\.get\("probe"\) === "1"/,
  );
  assert.match(configRoute, /if \(diagnosticProbe\) \{[\s\S]*probeDetailPageStudio/);
  assert.match(configRoute, /if \(diagnosticProbe\) \{[\s\S]*probeProtectedOpsCallback/);
  assert.match(configRoute, /engineUrl: connection\.browserUrl\.toString\(\)/);
  assert.match(configRoute, /diagnosticProbe,/);
});

test("the ordinary launch button requests fast config while real frame/local checks stay in their existing bounded paths", () => {
  assert.match(
    dockSource,
    /fetch\(ENGINE_CONFIG_API, \{ cache: "no-store", credentials: "same-origin" \}\)/,
  );
  assert.doesNotMatch(dockSource, /ENGINE_CONFIG_API \+ "\?probe=1"/);
  assert.match(dockSource, /LOCAL_BRIDGE_TIMEOUT_MS = 5 \* 1000/);
  assert.match(dockSource, /FRAME_HANDSHAKE_TIMEOUT_MS = 20 \* 1000/);
});
