# Keyword Lab discovery fail-open patch

- `discover_keywords` no longer fails the whole STEP 2 when optional AI recall times out.
- Seed + SearchAd candidates continue to scoring.
- AI discovery timeout is surfaced as a warning.
- Scoring uses 20-keyword chunks and explicit diagnostic error codes.
- STEP 2 renders the exact failure message in-place.
- No Shopling/Supabase writes. No AI-Saurus/detail-page SaaS changes.
