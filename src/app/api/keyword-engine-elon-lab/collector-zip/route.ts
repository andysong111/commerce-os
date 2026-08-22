import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = [
  "manifest.json",
  "content-1688-audit-v013.js",
  "content-1688-recovery-v013.js",
  "content-1688-health.js",
  "content-1688.js",
  "content-ops.js",
  "README.txt",
] as const;

export async function GET() {
  try {
    const root = resolve(process.cwd(), "public/keyword-lab-collector");
    const entries: Record<string, Uint8Array> = {};
    for (const name of FILES) {
      const buffer = await readFile(resolve(root, name));
      entries[name] = new Uint8Array(buffer);
    }
    const archive = zipSync(entries, { level: 7 });
    return new Response(Buffer.from(archive), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="commerce-os-keyword-lab-collector-v0.1.3.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "키워드 실험실 수집기 ZIP을 만들지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
