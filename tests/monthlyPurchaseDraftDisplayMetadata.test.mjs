import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/monthlyPurchaseDraftDisplayMetadata.ts", import.meta.url),
  "utf8",
);

test("monthly draft display prefers tracker and Product Master identity over legacy Shopling labels", () => {
  const modelNoBlock = source.match(/modelNo:\s*([\s\S]*?)modelName:/)?.[1] ?? "";
  const modelNameBlock = source.match(/modelName:\s*([\s\S]*?)saleOption:/)?.[1] ?? "";

  assert.match(modelNoBlock, /trackerUsable\?\.modelNumber/);
  assert.match(modelNoBlock, /profile\?\.modelNo/);
  assert.match(modelNoBlock, /live\?\.modelNo/);
  assert.ok(
    modelNoBlock.indexOf("trackerUsable?.modelNumber") <
      modelNoBlock.indexOf("live?.modelNo"),
    "tracker model number must win over Shopling fallback",
  );

  assert.match(modelNameBlock, /trackerUsable\?\.productName/);
  assert.match(modelNameBlock, /profile\?\.productName/);
  assert.match(modelNameBlock, /live\?\.modelName/);
  assert.ok(
    modelNameBlock.indexOf("trackerUsable?.productName") <
      modelNameBlock.indexOf("live?.modelName"),
    "tracker product name must win over Shopling fallback",
  );
});
