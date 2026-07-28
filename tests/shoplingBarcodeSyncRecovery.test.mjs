import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(
  new URL(
    "../src/components/shopling-barcode-sync/ShoplingBarcodeSyncRunner.tsx",
    import.meta.url,
  ),
  "utf8",
);
const runRoute = await readFile(
  new URL("../src/app/api/shopling-barcode-sync/run/route.ts", import.meta.url),
  "utf8",
);

test("saved request IDs are restored after hydration and result lookup remains available", () => {
  assert.match(component, /useEffect\(\(\) => \{/);
  assert.match(component, /window\.localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(component, /requestIdInputRef\.current\?\.value\.trim\(\)/);
  assert.match(component, /disabled=\{fetchingResult\}/);
  assert.doesNotMatch(
    component,
    /disabled=\{fetchingResult \|\| !currentRequestId\.trim\(\)\}/,
  );
});

test("GitHub 5xx dispatch responses are treated as uncertain to prevent duplicate runs", () => {
  assert.match(runRoute, /\/status=5\\d\\d\/\.test\(result\.message\)/);
  assert.match(runRoute, /status: "uncertain"/);
  assert.match(runRoute, /\{ status: 202 \}/);
  assert.match(runRoute, /같은 작업을 다시 누르지 말고 현재 실행 결과 확인/);
});
