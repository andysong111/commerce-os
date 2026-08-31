import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = [
  "manifest.json",
  "background-root.mjs",
  "content-group-canary.mjs",
  "README.txt",
] as const;

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};

  for (const fileName of FILES) {
    const bytes = await readFile(path.join(root, fileName));
    entries[fileName] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Market Group Canary v0.2.0\n");
  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-group-canary-v0.2.0.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
