# Bulk Supabase runtime checklist

- Production auth may succeed with the public Supabase key while server-side Bulk storage still fails independently.
- `NEXT_PUBLIC_SUPABASE_URL` and a public publishable/anon key power the user session.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` powers server-only Bulk job storage.
- The server-only client import must remain visible to the Vercel bundler.
