import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const testDirectory = dirname(new URL(import.meta.url).pathname);
  const directory = await mkdtemp(join(testDirectory, ".shopling-tls-"));
  const source = await readFile("src/lib/shopling/shoplingTlsTransport.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "shoplingTlsTransport.ts",
  }).outputText;
  const file = join(directory, "module.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const transport = await loadModule();

test("weak DH failure is detected through nested fetch causes", () => {
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("dh key too small"), {
      code: "ERR_SSL_DH_KEY_TOO_SMALL",
    }),
  });
  assert.equal(transport.shoplingTlsErrorCode(error), "ERR_SSL_DH_KEY_TOO_SMALL");
  assert.equal(transport.isShoplingWeakDhFailure(error), true);
  assert.equal(transport.isShoplingWeakDhFailure(new Error("other")), false);
});

test("legacy DH compatibility is restricted to the exact Shopling HTTPS host", () => {
  assert.equal(
    transport.isScopedShoplingLegacyDhTarget(
      "https://api.shopling.co.kr/order/order_gather_api.phtml?mode=2",
    ),
    true,
  );
  assert.equal(
    transport.isScopedShoplingLegacyDhTarget("http://api.shopling.co.kr/order"),
    false,
  );
  assert.equal(
    transport.isScopedShoplingLegacyDhTarget("https://shopling.co.kr/order"),
    false,
  );
  assert.equal(
    transport.isScopedShoplingLegacyDhTarget(
      "https://api.shopling.co.kr.evil.example/order",
    ),
    false,
  );
  assert.equal(
    transport.isScopedShoplingLegacyDhTarget(
      "https://user:pass@api.shopling.co.kr/order",
    ),
    false,
  );
});

test("TLS downgrade is request-scoped while certificate verification and TLS 1.2 remain mandatory", async () => {
  const [source, client] = await Promise.all([
    readFile("src/lib/shopling/shoplingTlsTransport.ts", "utf8"),
    readFile("src/lib/shopling/shoplingReadClient.ts", "utf8"),
  ]);
  assert.match(source, /DEFAULT@SECLEVEL=1/);
  assert.match(source, /rejectUnauthorized: true/);
  assert.match(source, /minVersion: "TLSv1\.2"/);
  assert.match(source, /SHOPLING_LEGACY_DH_HOST = "api\.shopling\.co\.kr"/);
  assert.match(source, /!isShoplingWeakDhFailure\(error\)/);
  assert.match(client, /postShoplingXml/);
  assert.doesNotMatch(source, /rejectUnauthorized: false/);
  assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED|NODE_OPTIONS|tls\.DEFAULT_CIPHERS/);
  assert.doesNotMatch(source, /process\.env\s*\[/);
  assert.doesNotMatch(source, /http:\/\/api\.shopling/);
});

test("compatibility transport remains bounded and does not log payloads", async () => {
  const source = await readFile(
    "src/lib/shopling/shoplingTlsTransport.ts",
    "utf8",
  );
  assert.match(source, /MAX_RESPONSE_BYTES = 64 \* 1024 \* 1024/);
  assert.match(source, /requestHandle\.setTimeout\(timeoutMs/);
  assert.match(source, /SHOPLING_RESPONSE_TOO_LARGE/);
  assert.match(source, /agent\.destroy\(\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(source, /writeFile|Supabase|commerce_operation_runs/);
});
