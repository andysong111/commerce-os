# Keyword Elon Lab Supabase 503 fallback

The keyword lab keeps Shopling reads isolated from persistence. Stage result persistence avoids the failing bulk `on_conflict` write path, retries transient 502/503/504 responses, and falls back to row-level PATCH followed by INSERT when the row does not yet exist. Supabase error bodies are bounded and included in the lab error message for diagnosis.
