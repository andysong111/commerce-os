import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.1";
const FILES = [
  "manifest.json",
  "background-root.mjs",
  "content-group-canary.mjs",
  "content-version-v031.mjs",
  "README.txt",
] as const;

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_fresh_worker_${name}_invalid: ${message}`);
  }
}

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};

  const manifestSource = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource) as { version?: string };
  if (manifest.version !== VERSION) throw new Error("shopling_fresh_worker_manifest_version_mismatch");
  entries["manifest.json"] = strToU8(manifestSource);

  for (const fileName of FILES.filter((file) => file.endsWith(".mjs"))) {
    const source = await readFile(path.join(root, fileName), "utf8");
    assertScript(fileName.replace(/\.mjs$/, ""), source);
    entries[fileName] = strToU8(source);
  }

  const background = new TextDecoder().decode(entries["background-root.mjs"]);
  const content = new TextDecoder().decode(entries["content-group-canary.mjs"]);
  if (background.includes("chrome.windows.create")) throw new Error("shopling_fresh_worker_must_not_create_public_launcher_window");
  if (!background.includes("findPersistentLauncherTab")) throw new Error("shopling_fresh_worker_persistent_launcher_lookup_missing");
  if (!background.includes("chrome.scripting.executeScript")) throw new Error("shopling_fresh_worker_launcher_click_missing");
  if (!background.includes("persistent_shopling_launcher_missing")) throw new Error("shopling_fresh_worker_launcher_guard_missing");
  if (!content.includes("1채널=1새창")) throw new Error("shopling_fresh_worker_contract_missing");
  if (!content.includes("isSubmitResultPage")) throw new Error("shopling_fresh_worker_result_guard_missing");

  const readme = await readFile(path.join(root, "README.txt"), "utf8");
  entries["README.txt"] = strToU8(readme);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Fresh Worker Canary v${VERSION}\n`);

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-fresh-worker-canary-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
