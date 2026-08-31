import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.4";
const FILES = [
  "manifest.json",
  "background-root.mjs",
  "content-group-canary.mjs",
  "content-version-v034.mjs",
  "README.txt",
] as const;

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_parallel_worker_${name}_invalid: ${message}`);
  }
}

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};

  const manifestSource = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource) as { version?: string; permissions?: string[]; content_scripts?: Array<{ js?: string[] }> };
  if (manifest.version !== VERSION) throw new Error("shopling_parallel_worker_manifest_version_mismatch");
  if (manifest.permissions?.includes("contentSettings")) throw new Error("shopling_parallel_worker_obsolete_popup_permission_present");
  if (manifest.permissions?.includes("scripting")) throw new Error("shopling_parallel_worker_obsolete_launcher_script_permission_present");
  if (!manifest.content_scripts?.[0]?.js?.includes("content-version-v034.mjs")) throw new Error("shopling_parallel_worker_v034_overlay_missing");
  entries["manifest.json"] = strToU8(manifestSource);

  for (const fileName of FILES.filter((file) => file.endsWith(".mjs"))) {
    const source = await readFile(path.join(root, fileName), "utf8");
    assertScript(fileName.replace(/\.mjs$/, ""), source);
    entries[fileName] = strToU8(source);
  }

  const background = new TextDecoder().decode(entries["background-root.mjs"]);
  const content = new TextDecoder().decode(entries["content-group-canary.mjs"]);
  if (!background.includes("chrome.tabs.duplicate")) throw new Error("shopling_parallel_worker_a18_duplicate_missing");
  if (!background.includes("Promise.allSettled")) throw new Error("shopling_parallel_worker_parallel_clone_missing");
  if (!background.includes("assignments")) throw new Error("shopling_parallel_worker_assignment_map_missing");
  if (!background.includes("parallel: true")) throw new Error("shopling_parallel_worker_parallel_contract_missing");
  if (background.includes("clickManagerAccessOnLauncher")) throw new Error("shopling_parallel_worker_obsolete_manager_launcher_present");
  if (background.includes("chrome.contentSettings")) throw new Error("shopling_parallel_worker_obsolete_popup_logic_present");
  if (!background.includes("group-canary-release-v0.3.2")) throw new Error("shopling_parallel_worker_claim_release_missing");
  if (!content.includes("commerceOsShoplingParallelWorkerV034")) throw new Error("shopling_parallel_worker_state_isolation_missing");
  if (!content.includes("1채널=1복제창")) throw new Error("shopling_parallel_worker_channel_contract_missing");
  if (!content.includes("ignoredSelpaFailures")) throw new Error("shopling_parallel_worker_selfa_policy_missing");
  if (!content.includes("nonIgnoredFailure")) throw new Error("shopling_parallel_worker_nonselfa_failure_guard_missing");
  if (!content.includes("isSubmitResultPage")) throw new Error("shopling_parallel_worker_result_guard_missing");

  const readme = await readFile(path.join(root, "README.txt"), "utf8");
  entries["README.txt"] = strToU8(readme);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Parallel Fresh Worker Canary v${VERSION}\n`);

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-parallel-fresh-worker-canary-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
