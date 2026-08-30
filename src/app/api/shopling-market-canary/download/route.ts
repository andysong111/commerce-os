import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST_PATH = "public/shopling-market-canary/manifest.json";
const BACKGROUND_ROOT_PATH = "public/shopling-market-canary/background-root.js";
const FILES = [
  ["background-market-canary.mjs", "public/shopling-market-canary/background-market-canary.js"],
  ["content-market-canary.mjs", "public/shopling-market-canary/content-market-canary.js"],
  ["README.txt", "public/shopling-market-canary/README.txt"],
] as const;

export async function GET() {
  const root = process.cwd();
  const entries: Record<string, Uint8Array> = {};

  const manifest = await readFile(path.join(root, MANIFEST_PATH));
  entries["manifest.json"] = new Uint8Array(manifest.buffer, manifest.byteOffset, manifest.byteLength);

  const backgroundRoot = (await readFile(path.join(root, BACKGROUND_ROOT_PATH), "utf8"))
    .replace(/background-market-canary\.js/g, "background-market-canary.mjs");
  entries["background-root.mjs"] = strToU8(backgroundRoot);

  for (const [archiveName, sourcePath] of FILES) {
    const bytes = await readFile(path.join(root, sourcePath));
    entries[archiveName] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Market Canary v0.1.3\n");

  // Store-only ZIP is intentionally used here for maximum compatibility with
  // Windows Explorer's built-in ZIP extractor. Script payloads use .mjs names
  // so downloaded ZIPs are not blocked at extraction time as legacy .js files.
  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-canary-v0.1.3.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
