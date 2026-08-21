# OpenAI cost attribution

Commerce OS server-side OpenAI calls are separated into cost lanes so usage can be traced by OpenAI project/API key instead of being mixed under one generic key.

## Cost lanes

| Cost lane | Vercel environment variable | Main use |
| --- | --- | --- |
| Keyword Engine | `KEYWORD_ENGINE_OPENAI_API_KEY` | Keyword identity, discovery, scoring, market recall, STEP 4 AI checks |
| Category AI | `SHOPLING_CATEGORY_OPENAI_API_KEY` | Shopling category catalog/recommendation/accuracy/repair, including product-launch AI category flow |
| Product Title AI | `PRODUCT_TITLE_OPENAI_API_KEY` | AI title-term generation |
| Ops AI Help | `OPS_AI_HELP_OPENAI_API_KEY` | OPS Center read-only AI help desk |

The product-launch AI category route delegates to the Shopling category engine, so it belongs to the same Category AI cost lane instead of pretending to be a separate OpenAI caller.

`OPENAI_API_KEY` remains a temporary fallback so production does not break while dedicated keys are being added. Do not put actual key values in GitHub.

## Recommended OpenAI projects

Create one OpenAI Platform project and one project API key per actual cost lane:

- `commerce-os-keyword-engine`
- `commerce-os-category-ai`
- `commerce-os-product-title`
- `commerce-os-ops-ai-help`

Use the matching project key in the Vercel environment variable above. Set a monthly budget/alert per OpenAI project. That makes the OpenAI Usage dashboard useful for cost attribution instead of showing one blended Commerce OS total.

## Migration order

1. Merge this change while keeping the existing `OPENAI_API_KEY` fallback.
2. Create the four OpenAI projects/API keys.
3. Add each dedicated environment variable to the Commerce OS Vercel project for Production (and Preview if needed).
4. Redeploy.
5. Run one controlled request in each lane and confirm usage appears in the intended OpenAI project/API key.
6. After all lanes are confirmed, remove the generic `OPENAI_API_KEY` value from the Commerce OS Vercel project so future unclassified calls fail loudly instead of hiding in shared spend.

## Rule for future AI features

Any new direct call to `api.openai.com` must be assigned to a dedicated cost lane before merge. `scripts/check-openai-cost-attribution.mjs` scans all direct OpenAI call sites, and the existing repository `CI` runs that guard automatically on pull requests.