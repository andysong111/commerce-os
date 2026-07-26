# Shopling Bulk Supabase runtime note

`src/lib/supabase/admin.ts` must load `@supabase/supabase-js` with a bundler-visible literal import.

Allowed:

```ts
await import("@supabase/supabase-js")
```

Do not hide the package name behind `Function(...)` or a computed specifier. Vercel serverless bundling may omit modules that cannot be statically discovered, which causes runtime-only failures even when login through the public Supabase client succeeds.
