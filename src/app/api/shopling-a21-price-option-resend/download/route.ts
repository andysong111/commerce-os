import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.1";
const ROOT = "shopling-a21-price-option-resend";
const FILES = [
  "manifest.json",
  "background-v020.js",
  "background-v030.js",
  "background-v031.js",
  "content-a21.js",
  "main-a21-v024.js",
  "content-a21-v024.js",
  "popup-run.html",
  "popup-run.js",
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
      const manifest = JSON.parse(source) as {
        manifest_version?: number;
        version?: string;
        permissions?: string[];
        background?: { service_worker?: string };
        action?: { default_popup?: string };
        content_scripts?: Array<{ js?: string[]; exclude_matches?: string[]; world?: string; match_about_blank?: boolean }>;
      };
      if (manifest.manifest_version !== 3) throw new Error("shopling_a21_resend_manifest_v3_required");
      if (manifest.version !== VERSION) throw new Error("shopling_a21_resend_manifest_version_mismatch");
      if (manifest.background?.service_worker !== "background-v031.js") throw new Error("shopling_a21_resend_background_v031_required");
      if (manifest.action?.default_popup !== "popup-run.html") throw new Error("shopling_a21_resend_run_popup_missing");
      const listRuntime = manifest.content_scripts?.find((item) => item.js?.includes("content-a21.js"));
      if (!listRuntime?.exclude_matches?.some((match) => match.includes("goods_mallMdfy_trsmt.phtml"))) {
        throw new Error("shopling_a21_resend_list_popup_separation_missing");
      }
      if (listRuntime.match_about_blank === true) {
        throw new Error("shopling_a21_resend_legacy_about_blank_injection_forbidden");
      }
      const popupRuntime = manifest.content_scripts?.find((item) => item.js?.includes("content-a21-v024.js"));
      if (!popupRuntime) throw new Error("shopling_a21_resend_v024_popup_runtime_missing");
      if (!manifest.content_scripts?.some((item) => item.js?.includes("main-a21-v024.js") && item.world === "MAIN")) {
        throw new Error("shopling_a21_resend_v024_main_world_bridge_missing");
      }
      if (manifest.content_scripts?.some((item) => item.js?.includes("result-wait-v028.js"))) {
        throw new Error("shopling_a21_resend_legacy_result_observer_forbidden");
      }
      if (!manifest.permissions?.includes("windows") || !manifest.permissions?.includes("tabs") || !manifest.permissions?.includes("scripting") || !manifest.permissions?.includes("webNavigation")) {
        throw new Error("shopling_a21_resend_permissions_missing");
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
