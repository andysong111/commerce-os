import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { buildStockWorker } from "../../../../../scripts/build-shopling-stock-worker-v023.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const VERSION = "0.2.3.2";
const FILES = ["manifest.json", "background-v020.js", "background-v023.js", "background-launch-v023.js", "content-ops-v021.js", "main-shopling.js", "a6-frame-bridge-v0231.js", "popup.html", "popup.js", "README.txt"];

export async function GET(request: Request) {
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const entries: Record<string, Uint8Array> = {};
  for (const name of FILES) {
    const source = await readFile(path.join(root, name), "utf8");
    if (name.endsWith(".js")) new Function(source);
    entries[name] = strToU8(source);
  }
  const template = await readFile(path.join(root, "content-shopling-v018.js"), "utf8");
  const policy = await readFile(path.join(root, "search-policy-v023.js"), "utf8");
  const worker = buildStockWorker(template, policy);
  entries["content-shopling-v023.js"] = strToU8(worker);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as {
    manifest_version: number; version: string; permissions: string[]; host_permissions: string[];
    background: { service_worker: string }; action: { default_popup: string };
    content_scripts: Array<{ js: string[]; matches: string[]; world?: string; all_frames?: boolean }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_state_manifest_version_mismatch");
  if (manifest.background.service_worker !== "background-launch-v023.js") throw new Error("shopling_stock_state_background_required");
  if (manifest.permissions.includes("debugger")) throw new Error("shopling_stock_state_debugger_forbidden");
  for (const permission of ["storage", "tabs", "windows", "scripting", "webNavigation", "alarms"]) {
    if (!manifest.permissions.includes(permission)) throw new Error(`shopling_stock_state_permission_missing:${permission}`);
  }
  for (const host of ["https://a.shopling.co.kr/*", "https://commerce-os-ops-center.vercel.app/*"]) {
    if (!manifest.host_permissions.includes(host)) throw new Error("shopling_stock_state_host_permissions_missing");
  }
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((s) => s.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_state_missing_packaged_file:${file}`);
  }
  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({ ok: true, version: VERSION, files: Object.keys(entries), zipBytes: zip.byteLength, workerSha256, searchStart: "2024-01-01", mode: "ADMIN_SOURCE_AUTO_WORKERS_A6_UNIQUE_CONTROL", liveShoplingVerified: false }, { headers: { "cache-control": "no-store" } });
  }
  return new Response(zip, { headers: {
    "content-type": "application/zip", "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}.zip"`,
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-stock-worker-sha256": workerSha256,
  }});
}
