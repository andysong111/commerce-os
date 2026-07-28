import test from "node:test";
import assert from "node:assert/strict";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { applyShoplingBarcodeSyncTokenFallback } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingBarcodeSyncTokenFallback.ts", import.meta.url),
);

const KEYS = [
  "SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN",
  "GITHUB_ENGINE_DISPATCH_TOKEN",
];

async function withEnv(values, fn) {
  const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const key of KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("dedicated barcode token remains the first choice", async () => {
  await withEnv(
    {
      SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN: "dedicated",
      GITHUB_ENGINE_DISPATCH_TOKEN: "legacy",
    },
    () => {
      assert.equal(applyShoplingBarcodeSyncTokenFallback(), "SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN");
      assert.equal(process.env.SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN, "dedicated");
    },
  );
});

test("existing engine dispatch token is reused when the dedicated token is absent", async () => {
  await withEnv({ GITHUB_ENGINE_DISPATCH_TOKEN: "legacy" }, () => {
    assert.equal(applyShoplingBarcodeSyncTokenFallback(), "GITHUB_ENGINE_DISPATCH_TOKEN");
    assert.equal(process.env.SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN, "legacy");
  });
});

test("missing tokens leave the environment unchanged", async () => {
  await withEnv({}, () => {
    assert.equal(applyShoplingBarcodeSyncTokenFallback(), null);
    assert.equal(process.env.SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN, undefined);
  });
});
