# Bulk Supabase runtime failure

A successful Supabase login proves only that the public auth client and browser session work. Bulk job storage additionally requires a server-only admin client. On Vercel, the package import must be statically discoverable by the bundler. Use a literal dynamic import and keep secret keys server-only.
