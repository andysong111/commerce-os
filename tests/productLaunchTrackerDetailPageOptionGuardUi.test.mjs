import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../public/product-launch-tracker-app/detail-page-option-guard.js",
    import.meta.url,
  ),
  "utf8",
);

test("option guard marks every empty visible option cell, not only selected rows", () => {
  assert.match(source, /querySelectorAll\("tr\[data-id\]"\)/);
  assert.match(source, /cell\.classList\.toggle\("detail-page-option-missing", missing\)/);
  assert.match(source, /warning\.textContent = MISSING_MESSAGE/);
});

test("single products receive explicit operator guidance instead of an inferred option", () => {
  assert.match(source, /단일 상품은 ‘단품’/);
  assert.match(source, /실제 판매 옵션을 입력/);
});
