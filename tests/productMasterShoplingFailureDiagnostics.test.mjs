import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Shopling diagnostic failure endpoint is same-origin, bounded and secret-redacted", async () => {
  const route = await read(
    "src/app/api/product-master/shopling-diagnostic/failures/route.ts",
  );
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE/);
  assert.match(route, /commerce_operation_runs/);
  assert.match(route, /\.limit\(10\)/);
  assert.match(route, /login_id\|company_id\|api_auth_key/);
  assert.match(route, /\{48,\}/);
  assert.match(route, /cache-control/);
  assert.doesNotMatch(route, /SHOPLING_API_AUTH_KEY|SHOPLING_LOGIN_ID|SHOPLING_COMPANY_ID/);
  assert.doesNotMatch(route, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});
