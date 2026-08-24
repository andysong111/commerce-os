import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(
  new URL("../scripts/reliability-autofix-worker.mjs", import.meta.url),
  "utf8",
);

test("autofix blocks brand-new capabilities but permits only bounded reuse of an existing one", () => {
  assert.match(worker, /beforeCount===0&&afterCount>0/);
  assert.match(worker, /beforeCount>0&&afterCount>beforeCount\+2/);
  assert.match(worker, /Autofix cannot introduce new capability/);
  assert.match(worker, /Autofix cannot excessively expand capability/);
  assert.doesNotMatch(
    worker,
    /countOccurrences\(after,token\)>countOccurrences\(before,token\)/,
  );
});
