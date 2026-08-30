import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST_PATH = "public/shopling-market-canary/manifest.json";
const BACKGROUND_ROOT_PATH = "public/shopling-market-canary/background-root.js";
const BACKGROUND_PATH = "public/shopling-market-canary/background-market-canary.js";
const CONTENT_PATH = "public/shopling-market-canary/content-market-canary.js";
const README_PATH = "public/shopling-market-canary/README.txt";

const LEGACY_FRAME_GUARD = 'if (location.hostname !== "a.shopling.co.kr" || location.pathname.startsWith("/prodlinkage/")) return false;';
const A18_FRAME_GUARD = 'if (location.hostname !== "a.shopling.co.kr") return false;\n    if (isIdChoicePage() || isPreProdChoicePage()) return false;';

export async function GET() {
  const root = process.cwd();
  const entries: Record<string, Uint8Array> = {};

  const manifest = await readFile(path.join(root, MANIFEST_PATH));
  entries["manifest.json"] = new Uint8Array(manifest.buffer, manifest.byteOffset, manifest.byteLength);

  const backgroundRoot = (await readFile(path.join(root, BACKGROUND_ROOT_PATH), "utf8"))
    .replace(/background-market-canary\.js/g, "background-market-canary.mjs");
  entries["background-root.mjs"] = strToU8(backgroundRoot);

  const background = await readFile(path.join(root, BACKGROUND_PATH));
  entries["background-market-canary.mjs"] = new Uint8Array(background.buffer, background.byteOffset, background.byteLength);

  const content = (await readFile(path.join(root, CONTENT_PATH), "utf8"))
    .replace(/const VERSION = "0\.1\.[23]";/, 'const VERSION = "0.1.4";')
    .replace(LEGACY_FRAME_GUARD, A18_FRAME_GUARD);
  if (content.includes(LEGACY_FRAME_GUARD)) {
    throw new Error("shopling_canary_a18_frame_guard_rewrite_failed");
  }
  entries["content-market-canary.mjs"] = strToU8(content);

  const readme = (await readFile(path.join(root, README_PATH), "utf8"))
    .replace(/v0\.1\.[23]/g, "v0.1.4");
  entries["README.txt"] = strToU8(readme);

  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Market Canary v0.1.4\n");

  // Store-only ZIP is intentionally used here for maximum compatibility with
  // Windows Explorer's built-in ZIP extractor. Script payloads use .mjs names
  // so downloaded ZIPs are not blocked at extraction time as legacy .js files.
  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-canary-v0.1.4.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
