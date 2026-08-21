import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const laneRules = [
  [/keywordEngineElonLab|api\/keyword-engine-elon-lab\//, "KEYWORD_ENGINE_OPENAI_API_KEY"],
  [/shoplingCategory/, "SHOPLING_CATEGORY_OPENAI_API_KEY"],
  [/api\/product-launch-tracker\/ai-category\//, "PRODUCT_CATEGORY_OPENAI_API_KEY"],
  [/productLaunchAiTitleTerms|api\/product-launch-ai-title-terms\//, "PRODUCT_TITLE_OPENAI_API_KEY"],
  [/opsAiHelp|api\/ops-ai-help\//, "OPS_AI_HELP_OPENAI_API_KEY"],
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const failures = [];
const classified = [];
for (const file of await walk("src")) {
  const source = readFileSync(file, "utf8");
  if (!source.includes("api.openai.com")) continue;
  const normalized = file.replaceAll("\\", "/");
  const rule = laneRules.find(([pattern]) => pattern.test(normalized));
  if (!rule) {
    failures.push(`${normalized}: direct OpenAI call has no registered cost lane`);
    continue;
  }
  const envName = rule[1];
  if (!source.includes(envName)) {
    failures.push(`${normalized}: expected dedicated key ${envName}`);
    continue;
  }
  classified.push(`${normalized} -> ${envName}`);
}

if (failures.length) {
  console.error("OpenAI cost-attribution guard failed:\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}
console.log("OpenAI cost-attribution guard passed.");
for (const row of classified) console.log(`- ${row}`);
