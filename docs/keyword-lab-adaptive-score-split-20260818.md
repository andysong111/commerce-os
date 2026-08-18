# Keyword Lab adaptive score splitting

Observed failure after browser-side scoring split:

- candidate discovery succeeds
- SearchAd succeeds
- a 20-keyword scoring chunk can still fail with `AI_SCORE_TIMEOUT`

## Change

- default browser scoring chunk: 12 keywords
- server scoring chunk: 12 keywords
- OpenAI scoring response no longer asks for a free-form rationale per keyword
- score rationale is rendered deterministically from returned relevance / shopping-intent / specificity values
- if a 12-keyword request returns timeout, incomplete response, or HTTP 504, the browser automatically splits it into 6 + 6
- if necessary, the split continues down to 3-keyword requests
- completed parent chunks are cached in localStorage and reused on the next STEP 2 execution
- candidate discovery is reused after a scoring error, avoiding unnecessary SearchAd calls

## Unchanged

- quality weighting and cutoff logic
- 1688 collection
- SearchAd data collection
- product title policy
- no Shopling/Supabase writes
- no AI-Saurus/detail-page SaaS changes
