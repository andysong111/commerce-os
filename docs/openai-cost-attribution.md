# OpenAI cost attribution

Commerce OS server-side OpenAI calls are isolated by deployed service and, inside OPS Center, by functional cost lane. The goal is to make every production dollar attributable and to avoid accidental preview/development spend.

## Canonical OpenAI projects

| OpenAI project | Production service | Production Vercel project |
| --- | --- | --- |
| `commerce-os-ops-center` | Commerce OS OPS Center | `commerce-os-ops-center` |
| `commerce-os-detail-page-studio` | Internal detail-page engine | `commerce-os-detail-page-studio` |
| `ai-saurus-production` | AI-Saurus customer SaaS | `commerce-os-detail-page-saas` |
| `commerce-os-sourcing-engine` | Commerce OS sourcing engine | `commerce-os-sourcing-engine` |

`commerce-os-development-test` is not part of the canonical setup and may be deleted.

The Vercel project `commerce-os-detail-page-studio-pzxe` is not part of the canonical production key map. Do not add a new production OpenAI key to it unless it is explicitly promoted to canonical production after a separate deployment audit.

## OPS Center production cost lanes

All four service accounts live inside the `commerce-os-ops-center` OpenAI project. OpenAI Usage can therefore show total OPS Center spend by project and functional spend by API key.

| Cost lane | OpenAI service account / key name | Vercel environment variable | Main use |
| --- | --- | --- | --- |
| Keyword Engine | `ops-keyword-engine` | `KEYWORD_ENGINE_OPENAI_API_KEY` | Keyword identity, discovery, scoring, market recall, STEP 4 AI checks |
| Category AI | `ops-category-ai` | `SHOPLING_CATEGORY_OPENAI_API_KEY` | Shopling category catalog/recommendation/accuracy/repair, including product-launch AI category flow |
| Product Title AI | `ops-product-title-ai` | `PRODUCT_TITLE_OPENAI_API_KEY` | AI title-term generation |
| Ops AI Help | `ops-ai-help` | `OPS_AI_HELP_OPENAI_API_KEY` | OPS Center read-only AI help desk |

The product-launch AI category route delegates to the Shopling category engine, so it belongs to the same Category AI cost lane.

## Other production runtimes

| OpenAI project | Service account / key name | Vercel environment variable |
| --- | --- | --- |
| `commerce-os-detail-page-studio` | `studio-runtime` | `OPENAI_API_KEY` |
| `ai-saurus-production` | `ai-saurus-runtime` | `OPENAI_API_KEY` |
| `commerce-os-sourcing-engine` | `sourcing-runtime` | `OPENAI_API_KEY` |

AI-Saurus `OPENAI_ADMIN_KEY` is a separate organization-cost reconciliation credential. It is not the runtime generation key and must not be replaced with `ai-saurus-runtime`.

## Vercel environment scope policy

Production service-account keys are configured for **Production only** by default. Leave Preview and Development unchecked unless OpenAI access is intentionally required there.

Do not reuse a Production runtime key in Preview or Development merely for convenience. That would mix preview/test calls into production project/key spend and create an unnecessary cost-bearing surface. If a future preview deployment genuinely needs live OpenAI access, create a dedicated preview service account inside the same service's OpenAI project and track it separately.

## Rotation order

1. Keep all legacy keys active during migration.
2. Add the new service-account keys to the canonical Vercel Production projects with Production scope only.
3. Redeploy each production project.
4. Run one controlled OpenAI-bearing request per production cost lane/service.
5. Confirm usage appears in the expected OpenAI project/API key.
6. Remove the generic/legacy Vercel key values only after every production lane is verified.
7. Revoke legacy OpenAI keys only after Vercel no longer references them and a final controlled smoke test passes.
8. Delete obsolete OpenAI projects only after confirming they have no active key or runtime dependency. Historical usage may be retained for accounting before deletion.

## Temporary OPS fallback

`OPENAI_API_KEY` remains a temporary OPS Center fallback so production does not break while the four dedicated variables are being added. After all four OPS lanes are verified, remove the generic `OPENAI_API_KEY` from the OPS Center Vercel Production environment so future unclassified calls fail loudly instead of hiding in shared spend.

## Rule for future AI features

Any new direct call to `api.openai.com` must be assigned to an explicit cost lane before merge. `scripts/check-openai-cost-attribution.mjs` scans direct OpenAI call sites, and the existing repository CI runs that guard automatically. Do not commit actual key values to GitHub.
