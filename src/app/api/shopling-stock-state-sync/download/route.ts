import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.1.1";
const ROOT = "shopling-stock-state-sync";
const FILES = [
  "manifest.json",
  "background-v011.js",
  "content-ops.js",
  "main-shopling.js",
  "content-shopling-v011.js",
  "popup.html",
  "popup.js",
  "README.txt",
] as const;

function assertJavaScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_stock_state_${name}_invalid:${message}`);
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
        host_permissions?: string[];
        background?: { service_worker?: string };
        action?: { default_popup?: string };
        content_scripts?: Array<{
          matches?: string[];
          js?: string[];
          world?: string;
          all_frames?: boolean;
        }>;
      };
      if (manifest.manifest_version !== 3) {
        throw new Error("shopling_stock_state_manifest_v3_required");
      }
      if (manifest.version !== VERSION) {
        throw new Error("shopling_stock_state_manifest_version_mismatch");
      }
      if (manifest.background?.service_worker !== "background-v011.js") {
        throw new Error("shopling_stock_state_background_required");
      }
      if (manifest.action?.default_popup !== "popup.html") {
        throw new Error("shopling_stock_state_popup_required");
      }
      for (const permission of [
        "storage",
        "tabs",
        "windows",
        "scripting",
        "webNavigation",
        "alarms",
      ]) {
        if (!manifest.permissions?.includes(permission)) {
          throw new Error(`shopling_stock_state_permission_missing:${permission}`);
        }
      }
      if (manifest.permissions?.includes("debugger")) {
        throw new Error("shopling_stock_state_debugger_forbidden");
      }
      if (
        !manifest.host_permissions?.includes("https://a.shopling.co.kr/*") ||
        !manifest.host_permissions?.includes(
          "https://commerce-os-ops-center.vercel.app/*",
        )
      ) {
        throw new Error("shopling_stock_state_host_permissions_missing");
      }
      const main = manifest.content_scripts?.find(
        (script) =>
          script.world === "MAIN" &&
          script.js?.includes("main-shopling.js") &&
          script.all_frames === true,
      );
      const shopling = manifest.content_scripts?.find((script) =>
        script.js?.includes("content-shopling-v011.js"),
      );
      const ops = manifest.content_scripts?.find((script) =>
        script.js?.includes("content-ops.js"),
      );
      if (!main || !shopling || !ops) {
        throw new Error("shopling_stock_state_content_scripts_missing");
      }
      if (shopling.all_frames !== true) {
        throw new Error("shopling_stock_state_shopling_all_frames_required");
      }
    }
    entries[fileName] = strToU8(source);
  }
  const zip = zipSync(entries, { level: 9 });
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
