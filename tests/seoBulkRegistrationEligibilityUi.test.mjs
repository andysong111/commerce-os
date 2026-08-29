import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Shopling 일괄등록 버튼은 실제 서버 등록 가능 상태인 idle RUN만 센다", async () => {
  const client = await source(
    "src/app/seo-bulk-cloud/SeoBulkDurableRunCloudClient.tsx",
  );
  assert.match(
    client,
    /const registerableRows = useMemo\([\s\S]*readyRows\.filter\(\(job\) => job\.registration_status === "idle"\)/,
  );
  assert.doesNotMatch(
    client,
    /registerableRows[\s\S]{0,220}!\["submitting", "queued", "running", "success"\]\.includes/,
  );
});
