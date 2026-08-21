from pathlib import Path

LANES: dict[str, list[str]] = {
    "KEYWORD_ENGINE_OPENAI_API_KEY": [
        "src/lib/keywordEngineElonLabIdentity.ts",
        "src/lib/keywordEngineElonLabV2Scoring.ts",
        "src/lib/keywordEngineElonLabV2Step4.ts",
        "src/lib/keywordEngineElonLabV2Server.ts",
        "src/lib/keywordEngineElonLabV2MarketRecall.ts",
        "src/lib/keywordEngineElonLabV2ApiHub.ts",
        "src/lib/keywordEngineElonLabV2Discovery.ts",
        "src/app/api/keyword-engine-elon-lab/route.ts",
    ],
    "SHOPLING_CATEGORY_OPENAI_API_KEY": [
        "src/lib/shoplingCategoryCatalog.ts",
        "src/lib/shoplingCategoryNaverFirst.ts",
        "src/lib/shoplingCategoryBranchRepair.ts",
        "src/lib/shoplingCategoryAccuracyV2.ts",
        "src/lib/shoplingCategoryShoplingFirst.ts",
        "src/lib/shoplingCategoryRecommendationRunner.ts",
    ],
    "PRODUCT_CATEGORY_OPENAI_API_KEY": [
        "src/app/api/product-launch-tracker/ai-category/route.ts",
    ],
    "PRODUCT_TITLE_OPENAI_API_KEY": [
        "src/lib/productLaunchAiTitleTerms.ts",
        "src/app/api/product-launch-ai-title-terms/route.ts",
    ],
}


def replace_generic_key(path: Path, dedicated_key: str) -> tuple[int, bool]:
    text = path.read_text(encoding="utf-8")
    if dedicated_key in text:
        return 0, False
    count = text.count("process.env.OPENAI_API_KEY")
    if count == 0:
        return 0, False
    text = text.replace(
        "process.env.OPENAI_API_KEY",
        f"(process.env.{dedicated_key} ?? process.env.OPENAI_API_KEY)",
    )
    path.write_text(text, encoding="utf-8")
    return count, True


changed: list[tuple[str, str, int]] = []
for dedicated_key, paths in LANES.items():
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists():
            raise SystemExit(f"Expected Commerce OS file is missing: {raw_path}")
        count, did_change = replace_generic_key(path, dedicated_key)
        if did_change:
            changed.append((raw_path, dedicated_key, count))

Path("docs/openai-cost-attribution.md").write_text(
    """# OpenAI cost attribution

Commerce OS server-side OpenAI calls are separated into cost lanes so usage can be traced by OpenAI project/API key instead of being mixed under one generic key.

## Cost lanes

| Cost lane | Vercel environment variable | Main use |
| --- | --- | --- |
| Keyword Engine | `KEYWORD_ENGINE_OPENAI_API_KEY` | Keyword identity, discovery, scoring, market recall, STEP 4 AI checks |
| Shopling Category AI | `SHOPLING_CATEGORY_OPENAI_API_KEY` | Shopling category catalog/recommendation/accuracy/repair |
| Product Category AI | `PRODUCT_CATEGORY_OPENAI_API_KEY` | Product launch tracker AI category selection |
| Product Title AI | `PRODUCT_TITLE_OPENAI_API_KEY` | AI title-term generation |
| Ops AI Help | `OPS_AI_HELP_OPENAI_API_KEY` | OPS Center read-only AI help desk (already separated before this migration) |

`OPENAI_API_KEY` remains a temporary fallback so production does not break while dedicated keys are being added. Do not put actual key values in GitHub.

## Recommended OpenAI projects

Create one OpenAI Platform project and one project API key per lane:

- `commerce-os-keyword-engine`
- `commerce-os-shopling-category`
- `commerce-os-product-category`
- `commerce-os-product-title`
- `commerce-os-ops-ai-help`

Use the matching project key in the Vercel environment variable above. Set a monthly budget/alert per OpenAI project. That makes the OpenAI Usage dashboard useful for cost attribution instead of showing one blended Commerce OS total.

## Migration order

1. Merge this change while keeping the existing `OPENAI_API_KEY` fallback.
2. Create the five OpenAI projects/API keys.
3. Add each dedicated environment variable to the Commerce OS Vercel project for Production (and Preview if needed).
4. Redeploy.
5. Run one controlled request in each lane and confirm usage appears in the intended OpenAI project/API key.
6. After all lanes are confirmed, remove the generic `OPENAI_API_KEY` value from the Commerce OS Vercel project so future unclassified calls fail loudly instead of hiding in shared spend.

## Rule for future AI features

Any new direct call to `api.openai.com` must be assigned to a dedicated cost lane before merge. The repository CI guard enforces this for known lanes and rejects unclassified direct OpenAI call sites.
""",
    encoding="utf-8",
)

Path("scripts/check-openai-cost-attribution.mjs").write_text(
    r'''import { readFileSync } from "node:fs";
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
''',
    encoding="utf-8",
)

Path(".github/workflows/openai-cost-attribution-ci.yml").write_text(
    """name: OpenAI Cost Attribution CI

on:
  pull_request:
    paths:
      - "src/**"
      - "scripts/check-openai-cost-attribution.mjs"
      - ".github/workflows/openai-cost-attribution-ci.yml"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.13.0
      - run: node scripts/check-openai-cost-attribution.mjs
""",
    encoding="utf-8",
)

if not changed:
    print("No generic OpenAI API key references needed migration; documentation/guard refreshed.")
else:
    print("OpenAI cost attribution changes:")
    for path, key, count in changed:
        print(f"- {path}: {count} reference(s) -> {key} with OPENAI_API_KEY fallback")
