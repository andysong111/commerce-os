import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = [
  ["manifest.json", "public/shopling-market-canary/manifest.json"],
  ["background-root.js", "public/shopling-market-canary/background-root.js"],
  ["background-market-canary.js", "public/shopling-market-canary/background-market-canary.js"],
  ["background-shopling-pipeline.js", "public/shopling-account-title-bridge/background-shopling-pipeline.js"],
  ["content-canary-frame-router.js", "public/shopling-market-canary/content-canary-frame-router.js"],
  ["content-shopling-pipeline.js", "public/shopling-account-title-bridge/content-shopling-pipeline.js"],
  ["content-market-canary.js", "public/shopling-market-canary/content-market-canary.js"],
  ["README.txt", "public/shopling-market-canary/README.txt"],
] as const;

export async function GET() {
  const root = process.cwd();
  const entries: Record<string, Uint8Array> = {};

  for (const [archiveName, sourcePath] of FILES) {
    const bytes = await readFile(path.join(root, sourcePath));
    entries[archiveName] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Market Canary v0.1.1\n");
  const archive = zipSync(entries, { level: 6 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-canary-v0.1.1.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
