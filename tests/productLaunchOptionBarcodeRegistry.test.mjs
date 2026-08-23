import assert from "node:assert/strict";
import test from "node:test";

import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  buildOptionBarcodeIdentity,
  canonicalizeOptionSetComposition,
  normalizeOptionBCode,
} = await importTranspiledTypeScript(
  new URL("../src/lib/productLaunchOptionBarcodeRegistry.ts", import.meta.url),
);

test("B코드는 공백과 대소문자를 제거해 동일 identity로 수렴한다", () => {
  assert.equal(normalizeOptionBCode(" bgb1-1 "), "BGB1-1");
  const left = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "item-a",
    optionId: "opt-a",
    option: { barcode: "bgb1-1" },
  });
  const right = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "item-b",
    optionId: "opt-b",
    option: { barcode: " BGB1-1 " },
  });
  assert.equal(left.identityKey, "B:BGB1-1");
  assert.equal(right.identityKey, left.identityKey);
  assert.equal(left.identityKind, "B_CODE");
});

test("B코드가 없는 옵션은 상품·옵션별 임시 identity를 갖는다", () => {
  const identity = buildOptionBarcodeIdentity({
    ownerId: "owner-1",
    itemId: "item-1",
    optionId: "option-1",
    option: { saleOption: "단품" },
  });
  assert.equal(identity.identityKey, "OPTION:owner-1:item-1:option-1");
  assert.equal(identity.identityKind, "OPTION");
});

test("세트 구성은 입력 순서와 무관하게 같은 identity를 만들고 수량이 다르면 새 identity가 된다", () => {
  const compositionA = [
    { bCode: "BAA1-1", option: "블랙", quantity: 2 },
    { bCode: "BAA1-2", option: "화이트", quantity: 1 },
  ];
  const compositionB = [...compositionA].reverse();
  assert.deepEqual(
    canonicalizeOptionSetComposition(compositionA),
    canonicalizeOptionSetComposition(compositionB),
  );

  const setA = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "set-a",
    optionId: "set-opt-a",
    option: { setComposition: compositionA },
  });
  const setB = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "set-b",
    optionId: "set-opt-b",
    option: { setComposition: compositionB },
  });
  const differentQuantity = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "set-c",
    optionId: "set-opt-c",
    option: {
      setComposition: [
        { bCode: "BAA1-1", option: "블랙", quantity: 3 },
        { bCode: "BAA1-2", option: "화이트", quantity: 1 },
      ],
    },
  });

  assert.match(setA.identityKey, /^SET:[A-F0-9]{32}$/);
  assert.equal(setA.identityKind, "SET");
  assert.equal(setA.identityKey, setB.identityKey);
  assert.notEqual(setA.identityKey, differentQuantity.identityKey);
});
