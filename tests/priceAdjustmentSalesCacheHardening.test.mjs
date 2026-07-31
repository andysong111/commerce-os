import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL(
  "../src/app/api/integrations/price-adjustment/sales-cache/push/route.ts",
  import.meta.url,
);

test("price adjustment sales cache accepts flexible non-empty location codes", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.doesNotMatch(source, /BARCODE_PATTERN/);
  assert.match(source, /CONTROL_CHARACTER_PATTERN/);
  assert.match(source, /barcode\.length > 120/);
  assert.match(source, /sourceMonths\.length > MAX_MONTHS/);
});
