import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OpsCurrentUser = {
  id: string;
  email?: string;
};

export type OpsCurrentUserResult = {
  user: OpsCurrentUser | null;
  error: string | null;
  configured: boolean;
};

async function loadOpsCurrentUser(): Promise<OpsCurrentUserResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      user: null,
      error: "Supabase public auth configuration is missing.",
      configured: false,
    };
  }

  const { data, error } = await supabase.auth.getUser();
  return {
    user: data.user,
    error: error?.message ?? null,
    configured: true,
  };
}

// AppShell and a protected page render in the same React Server Components
// request. Sharing this promise prevents two concurrent getUser calls from
// racing while Supabase rotates or validates the same auth session.
export const getOpsCurrentUser = cache(loadOpsCurrentUser);
