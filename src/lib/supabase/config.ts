type SupabasePublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

export function getSupabasePublicConfig(
  env: SupabasePublicEnv = {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publicKey = publishableKey || anonKey;
  const publicKeyName = publishableKey
    ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    : anonKey
      ? "NEXT_PUBLIC_SUPABASE_ANON_KEY"
      : null;

  const missing = [
    !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !publicKey ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
  ].filter(Boolean) as string[];

  return {
    ok: missing.length === 0,
    url: url ?? "",
    publicKey: publicKey ?? "",
    publicKeyName,
    missing,
  };
}
