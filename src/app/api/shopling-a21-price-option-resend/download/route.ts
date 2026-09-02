import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.1.4";
const ROOT = "shopling-a21-price-option-resend";
const FILES = [
  "manifest.json",
  "background-v012.js",
  "background-v013.js",
  "background-v013-overlay.js",
  "content-a21.js",
  "content-a21-v014.js",
  "popup.html",
  "popup.js",
  "README.txt",
] as const;

function assertJavaScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_a21_resend_${name}_invalid:${message}`);
  }
}

export async function GET() {
  const publicRoot = path.join(process.cwd(), "public", ROOT);
  const entries: Record<string, Uint8Array> = {};
  for (const fileName of FILES) {
    const source = await readFile(path.join(publicRoot, fileName), "utf8");
    if (fileName.endsWith(".js")) assertJavaScript(fileName, source);
    if (fileName === "manifest.json") {
      const manifest = JSON.parse(source) as { manifest_version?: number; version?: string; permissions?: string[]; background?: { service_worker?: string }; content_scripts?: Array<{ js?: string[] }> };
      if (manifest.manifest_version !== 3) throw new Error("shopling_a21_resend_manifest_v3_required");
      if (manifest.version !== VERSION) throw new Error("shopling_a21_resend_manifest_version_mismatch");
      if (manifest.background?.service_worker !== "background-v013.js") throw new Error("shopling_a21_resend_background_version_mismatch");
      if (!manifest.content_scripts?.some((item) => item.js?.includes("content-a21-v014.js"))) throw new Error("shopling_a21_resend_exact_control_content_missing");
      if (!manifest.permissions?.includes("windows") || !manifest.permissions?.includes("tabs") || !manifest.permissions?.includes("scripting")) {
        throw new Error("shopling_a21_resend_parallel_permissions_missing");
      }
    }
    entries[fileName] = strToU8(source);
  }
  const zip = zipSync(entries, { level: 9 });
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-a21-resend-v${VERSION}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
