import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const chunksRoot = fileURLToPath(
  new URL("../.next/static/chunks/", import.meta.url),
);
const expectedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const expectedKeys = [
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
].filter(Boolean);

assert.ok(expectedUrl, "NEXT_PUBLIC_SUPABASE_URL is required for bundle verification");
assert.ok(
  expectedKeys.length > 0,
  "a public Supabase key is required for bundle verification",
);

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return javascriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    }),
  );
  return nested.flat();
}

const files = await javascriptFiles(chunksRoot);
const chunks = await Promise.all(files.map((path) => readFile(path, "utf8")));
const clientBundle = chunks.join("\n");

assert.match(
  clientBundle,
  /shopling-price-adjustment-auth-required/,
  "the price-adjustment auth client was not emitted",
);
assert.ok(
  clientBundle.includes(expectedUrl),
  "the Supabase URL was not statically embedded in the client bundle",
);
for (const expectedKey of expectedKeys) {
  assert.ok(
    clientBundle.includes(expectedKey),
    "a Supabase public key was not statically embedded in the client bundle",
  );
}
assert.doesNotMatch(
  clientBundle,
  /\.env\.NEXT_PUBLIC_SUPABASE_(?:URL|PUBLISHABLE_KEY|ANON_KEY)/,
  "a dynamic Supabase public env lookup remains in the client bundle",
);

console.log("Price-adjustment browser auth config is embedded in the client bundle.");
