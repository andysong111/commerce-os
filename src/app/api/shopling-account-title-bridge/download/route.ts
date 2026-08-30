import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = [
  "manifest.json",
  "content-shopling-account-titles.js",
  "content-shopling-product-list-batch.js",
  "background-shopling-root.js",
  "background-shopling-title-batch.js",
  "background-shopling-seo-keywords.js",
  "README.txt",
] as const;

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-account-title-bridge");
  const entries: Record<string, Uint8Array> = {};

  for (const fileName of FILES) {
    const bytes = await readFile(path.join(root, fileName));
    entries[fileName] = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
  }

  entries["VERSION.txt"] = strToU8(
    "Commerce OS Shopling Account Title Bridge v0.3.1\n",
  );

  const archive = zipSync(entries, { level: 6 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        'attachment; filename="commerce-os-shopling-account-title-bridge-v0.3.1.zip"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
