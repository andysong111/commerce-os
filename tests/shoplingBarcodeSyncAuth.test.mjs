import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authSource = await readFile(
  new URL("../src/lib/shoplingBarcodeSyncAuth.ts", import.meta.url),
  "utf8",
);
const runRouteSource = await readFile(
  new URL("../src/app/api/shopling-barcode-sync/run/route.ts", import.meta.url),
  "utf8",
);
const resultRouteSource = await readFile(
  new URL("../src/app/api/shopling-barcode-sync/result/route.ts", import.meta.url),
  "utf8",
);

test("barcode sync requires feature flag, login, and allowlisted email", () => {
  assert.match(authSource, /SHOPLING_BARCODE_SYNC_ENABLED\s*!==\s*"1"/);
  assert.match(authSource, /SHOPLING_BARCODE_SYNC_ALLOWED_EMAILS/);
  assert.match(authSource, /OPS_OWNER_EMAILS/);
  assert.match(authSource, /supabase\.auth\.getUser\(\)/);
  assert.match(authSource, /allowedEmails\.has\(email\)/);
  assert.match(authSource, /status:\s*401/);
  assert.match(authSource, /status:\s*403/);
});

test("both dispatch and result routes enforce operator authorization", () => {
  for (const source of [runRouteSource, resultRouteSource]) {
    assert.match(source, /requireShoplingBarcodeSyncOperator/);
    assert.match(source, /if \(auth\.response\) return auth\.response/);
  }
});

test("dispatch route rejects null, arrays, and other non-object bodies", () => {
  assert.match(runRouteSource, /!value \|\| typeof value !== "object" \|\| Array\.isArray\(value\)/);
  assert.match(runRouteSource, /요청 본문은 JSON 객체여야 합니다/);
});
