import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const archivePath = "/tmp/product-launch-performance.tar.gz";
const partPaths = Array.from(
  { length: 7 },
  (_, index) =>
    `scripts/.product-launch-performance.part${String(index + 1).padStart(2, "0")}`,
);
const expectedParts = [
  { length: 7_000, sha256: "3afa9eb34898903d59bcd69d3e0a69da2585d498f4099fd77333b1253b7ede4d" },
  { length: 7_000, sha256: "45d3c2c8685ca829c1fce342ac509f9a03d4b374787b6efb6d2262edcc7d48a5" },
  { length: 7_000, sha256: "7c56b64466048545567471aeb1ddab279fc1593116b9aa70184e6c3583a17185" },
  { length: 7_000, sha256: "2cd2d7fd3c3ff64a58f1ce5103b584455a0178c7ddd4704022585317e449fea2" },
  { length: 7_000, sha256: "e3e81bf2b199615ec62e342d0ee2369cc34e99640f411b14f0f5b29d63e9a23d" },
  { length: 7_000, sha256: "073491438d826532a0c49bc58d617bf8ed3e5152d4f47b747517f3b28f8fa910" },
  { length: 3_688, sha256: "2783f57f2f758d60a9fb2cc85197295bbd51d450398d35091df954c7c51011bb" },
];
const expectedArchiveSha256 = "c08034c831e50882d0f5ec57c97f846e3315267a6fd6cf6dec97ff2d0cac9ace";
const expectedFiles = [
  "src/lib/productLaunchTrackerOptimized.ts",
  "src/app/api/product-launch-tracker/optimized/route.ts",
  "src/app/api/product-launch-tracker/state/route.ts",
  "public/product-launch-tracker-app/optimized-app.js",
  "public/product-launch-tracker-app/app.js",
  "tests/productLaunchTrackerOptimized.test.mjs",
  "tests/productLaunchTrackerOptimizedContracts.test.mjs",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const corruptParts = [];
const encodedParts = await Promise.all(
  partPaths.map(async (partPath, index) => {
    const part = (await readFile(partPath, "utf8")).trim();
    const actual = { length: part.length, sha256: sha256(part) };
    const expected = expectedParts[index];
    console.log(`${partPath}: length=${actual.length} sha256=${actual.sha256}`);
    if (actual.length !== expected.length || actual.sha256 !== expected.sha256) {
      corruptParts.push(
        `part ${index + 1}: expected length=${expected.length} sha256=${expected.sha256}`,
      );
    }
    return part;
  }),
);
if (corruptParts.length) {
  throw new Error(`Corrupt payload parts:\n${corruptParts.join("\n")}`);
}
const encoded = encodedParts.join("");

if (!encoded) {
  throw new Error("Product launch performance payload is empty.");
}

const archive = Buffer.from(encoded, "base64");
const archiveSha256 = sha256(archive);
if (archiveSha256 !== expectedArchiveSha256) {
  throw new Error(
    `Corrupt product launch archive: expected ${expectedArchiveSha256}, got ${archiveSha256}`,
  );
}
await writeFile(archivePath, archive);

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
