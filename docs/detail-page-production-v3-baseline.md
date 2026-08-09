# Product Launch Detail Page Production v3 Baseline

Production generation in `상품출시진행관리 > 선택 상세페이지 생성` is the protected baseline.

## Frozen Studio snapshot

- Repository: `andysong111/commerce-os-detail-page-studio`
- Stable branch: `stable/ops-v3-production-20260809`
- Baseline commit: `48ee179b4c7cd067c93ddbcfa3fd02a2a349796e`
- Engine profile: `source-first-v3`
- Commerce assets: main 1 + supplemental 4
- Detail image: 1000 x 14000

## Production rule

- Product Launch normal generation remains the supported production path.
- Evidence Compiler code is retained only for historical/research compatibility.
- Compiler canary controls and parallel canary workers are not mounted in the production UI.
- Do not modify the stable branch. New experiments must use a separate branch and must not replace the Product Launch production path until independently approved.

## Recovery

If a future change degrades production output, compare against or restore from the Studio stable branch above, then verify Product Launch normal generation with representative cross-category products before promotion.
