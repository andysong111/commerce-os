import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/detail-page-dock.js",
    import.meta.url,
  ),
  "utf8",
);
const jobsRoute = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("detail-page jobs preserve the launch tracker option field", () => {
  assert.match(dockSource, /salesOptions: readSalesOptions\(item\)/);
  assert.match(dockSource, /\.map\(\(option\) => String\(option\?\.saleOption/);
  assert.match(dockSource, /\.join\(" \/ "\)/);
  assert.match(jobsRoute, /salesOptions: safeText\(body\?\.salesOptions, 2_000\)/);
  assert.match(jobsRoute, /sales_options: input\.salesOptions/);
});
