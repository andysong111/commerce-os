import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const archivePath = "/tmp/product-launch-performance.tar.gz";
const partPaths = Array.from(
  { length: 7 },
  (_, index) =>
    `scripts/.product-launch-performance.part${String(index + 1).padStart(2, "0")}`,
);
const expectedFiles = [
  "src/lib/productLaunchTrackerOptimized.ts",
  "src/app/api/product-launch-tracker/optimized/route.ts",
  "src/app/api/product-launch-tracker/state/route.ts",
  "public/product-launch-tracker-app/optimized-app.js",
  "public/product-launch-tracker-app/app.js",
  "tests/productLaunchTrackerOptimized.test.mjs",
  "tests/productLaunchTrackerOptimizedContracts.test.mjs",
];

const encoded = (
  await Promise.all(partPaths.map((partPath) => readFile(partPath, "utf8")))
)
  .map((part) => part.trim())
  .join("");

if (!encoded) {
  throw new Error("Product launch performance payload is empty.");
}

await writeFile(archivePath, Buffer.from(encoded, "base64"));

const entries = execFileSync("tar", ["-tzf", archivePath], {
  cwd: root,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .map((entry) => entry.trim().replace(/^\.\//, ""))
  .filter(Boolean);

for (const entry of entries) {
  if (path.isAbsolute(entry) || entry.split("/").includes("..")) {
    throw new Error(`Unsafe archive entry: ${entry}`);
  }
}
for (const expectedFile of expectedFiles) {
  if (!entries.includes(expectedFile)) {
    throw new Error(`Missing expected archive entry: ${expectedFile}`);
  }
}

execFileSync("tar", ["-xzf", archivePath, "-C", root], {
  cwd: root,
  stdio: "inherit",
});

for (const expectedFile of expectedFiles) {
  await access(path.join(root, expectedFile));
}

for (const javascriptFile of [
  "public/product-launch-tracker-app/optimized-app.js",
  "public/product-launch-tracker-app/app.js",
]) {
  execFileSync(process.execPath, ["--check", javascriptFile], {
    cwd: root,
    stdio: "inherit",
  });
}

execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "tests/productLaunchTrackerOptimized.test.mjs",
    "tests/productLaunchTrackerOptimizedContracts.test.mjs",
  ],
  { cwd: root, stdio: "inherit" },
);

console.log(`Materialized and verified ${expectedFiles.length} product launch performance files.`);
