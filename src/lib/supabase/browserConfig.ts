export function getSupabaseBrowserPublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const missing = [
    !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !publicKey ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : null,
  ].filter(Boolean) as string[];

  return {
    ok: missing.length === 0,
    url: url ?? "",
    publicKey: publicKey ?? "",
    publicKeyName: publicKey
      ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
      : null,
    missing,
  };
}
