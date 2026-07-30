import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseBrowserPublicConfig } from "@/lib/supabase/config";
import { getOpsAuthCookieOptions } from "@/lib/supabase/session";

export async function createSupabaseBrowserClient() {
  const config = getSupabaseBrowserPublicConfig();
  if (!config.ok) return null;

  return createBrowserClient(config.url, config.publicKey, {
    cookieOptions: getOpsAuthCookieOptions(),
  });
}
