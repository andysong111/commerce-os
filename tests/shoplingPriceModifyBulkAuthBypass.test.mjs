import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("bulk price jobs honor the temporary Ops login bypass without allowing cross-site calls", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkApi.ts");

  for (const phrase of [
    'import { headers } from "next/headers"',
    "isOpsLoginTemporarilyDisabled",
    "isSameOriginOpsRequest",
    "temporaryOpsIdentity",
    "currentOpsRequestFromHeaders",
    "OPS_LOGIN_BYPASS_SAME_ORIGIN_REQUIRED",
    "normalAdminSession(temporaryOpsIdentity().userId)",
    "normalAdminSession(data.user.id)",
  ]) {
    assert.match(
      source,
      new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  const bypassStart = source.indexOf("if (isOpsLoginTemporarilyDisabled())");
  const sameOriginGuard = source.indexOf("isSameOriginOpsRequest(opsRequest)", bypassStart);
  const temporaryOwner = source.indexOf(
    "normalAdminSession(temporaryOpsIdentity().userId)",
    bypassStart,
  );

  assert.ok(bypassStart >= 0);
  assert.ok(sameOriginGuard > bypassStart);
  assert.ok(temporaryOwner > sameOriginGuard);
  assert.match(
    source,
    /requestHeaders\.forEach\([\s\S]*?new Request\(`\$\{protocol\}:\/\/\$\{host\}\//,
  );
});
