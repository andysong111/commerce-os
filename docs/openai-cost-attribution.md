# OpenAI cost attribution

Commerce OS production OpenAI usage is isolated first by deployed service and, inside OPS Center, by functional API key. This is the canonical key map for cost attribution and rotation.

## Canonical OpenAI projects

| OpenAI project | Production service | Vercel project |
| --- | --- | --- |
| `commerce-os-ops-center` | Commerce OS OPS Center | `commerce-os-ops-center` |
| `commerce-os-detail-page-studio` | Internal detail-page engine | `commerce-os-detail-page-studio` |
| `ai-saurus-production` | AI-Saurus customer SaaS | `commerce-os-detail-page-saas` |
| `commerce-os-sourcing-engine` | Commerce OS sourcing engine / semantic mapping | `commerce-os-sourcing-engine` |

`commerce-os-development-test` is not part of the canonical setup and may be deleted.

The Vercel project `commerce-os-detail-page-studio-pzxe` is not canonical. Do not add a new production OpenAI key to it. The canonical Studio project is `commerce-os-detail-page-studio`.

## OPS Center cost lanes

All four service accounts live inside the single `commerce-os-ops-center` OpenAI project. Project-level Usage shows total OPS spend and API-key-level Usage separates the functional lanes.

| Cost lane | OpenAI service account | Vercel environment variable | Main use |
| --- | --- | --- | --- |
| Keyword Engine | `ops-keyword-engine` | `KEYWORD_ENGINE_OPENAI_API_KEY` | Keyword identity, discovery, scoring, market recall, STEP 4 checks |
| Category AI | `ops-category-ai` | `SHOPLING_CATEGORY_OPENAI_API_KEY` | Shopling category catalog/recommendation/accuracy/repair and product-launch AI category flow |
| Product Title AI | `ops-product-title-ai` | `PRODUCT_TITLE_OPENAI_API_KEY` | AI title-term generation |
| Ops AI Help | `ops-ai-help` | `OPS_AI_HELP_OPENAI_API_KEY` | OPS Center read-only AI help desk |

The product-launch AI category route delegates to the Shopling category engine and therefore belongs to Category AI rather than a separate cost lane.

## Other production runtimes

| OpenAI project | Service account | Vercel environment variable |
| --- | --- | --- |
| `commerce-os-detail-page-studio` | `studio-runtime` | `OPENAI_API_KEY` |
| `ai-saurus-production` | `ai-saurus-runtime` | `OPENAI_API_KEY` |
| `commerce-os-sourcing-engine` | `sourcing-runtime` | `OPENAI_API_KEY` |

AI-Saurus `OPENAI_ADMIN_KEY` is a separate organization-cost reconciliation credential. It is not the runtime generation key and must not be replaced with `ai-saurus-runtime`.

## Vercel environment scope

Production service-account keys are configured for **Production only** by default. Preview and Development stay unchecked unless a dedicated non-production key is intentionally created later.

Do not reuse a Production runtime key in Preview or Development. That would mix test traffic into production spend and enlarge the cost-bearing surface.

## Production key verification

OPS Center has two permanent verification layers:

1. `scripts/check-openai-cost-attribution.mjs` fails CI if a direct OpenAI caller is not assigned to a registered cost lane.
2. `scripts/verify-openai-production-keys.mjs` runs before a Vercel Production build and authenticates all four dedicated OPS keys. A missing or invalid dedicated key prevents a new Production deployment from replacing the current working deployment.

The owner-only `/openai-key-health` page and `/api/openai-key-health` route can also verify the four OPS keys without exposing key values.

Studio, AI-Saurus and Sourcing use equivalent Production build gates for their runtime `OPENAI_API_KEY`. These gates must not print key values or raw provider responses containing secrets.

## Rotation / cleanup order

1. Create the replacement service-account key inside the correct canonical OpenAI project.
2. Replace only the matching Vercel Production environment variable.
3. Redeploy Production.
4. Require the Production key gate and Vercel deployment to succeed.
5. Only then remove the legacy Vercel key or revoke the old OpenAI key.
6. Delete duplicate/noncanonical deployments before revoking any key they may still reference.
7. Keep `OPENAI_ADMIN_KEY` separate from AI-Saurus runtime rotation.

OPS Center direct OpenAI callers no longer use the generic `OPENAI_API_KEY` fallback. The operator confirmed removal of the generic Vercel `OPENAI_API_KEY` on 2026-08-22. Future Production builds require all four dedicated variables and must pass the Production key verification gate.

## Rule for future AI features

Any new direct call to `api.openai.com` must be assigned to an explicit cost lane before merge. Do not commit actual API key values to GitHub. New production services should receive their own OpenAI project or explicitly documented service account so Usage remains attributable.
