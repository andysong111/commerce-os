import fs from "node:fs";
import { pathToFileURL } from "node:url";

const patchPath = "scripts/fix-product-launch-detail-link-regression.mjs";
let source = fs.readFileSync(patchPath, "utf8");
const malformedTemplate = /\\\\`\\\$\{OPTIMIZED_TRACKER_API\}\?\\\$\{params\.toString\(\)\}\\\\`/;
if (!malformedTemplate.test(source)) {
  throw new Error("temporary patch runner repair anchor was not found");
}
source = source.replace(
  malformedTemplate,
  'OPTIMIZED_TRACKER_API + "?" + params.toString()',
);
fs.writeFileSync(patchPath, source);
await import(pathToFileURL(patchPath).href);
