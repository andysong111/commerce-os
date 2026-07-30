import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OpsCurrentUser = {
  id: string;
  email?: string;
};

export type OpsCurrentUserResult = {
  user: OpsCurrentUser | null;
  accessToken: string | null;
  error: string | null;
  configured: boolean;
};

async function loadOpsCurrentUser(): Promise<OpsCurrentUserResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      user: null,
      accessToken: null,
      error: "Supabase public auth configuration is missing.",
      configured: false,
    };
  }

  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;
  const accessToken = session?.access_token ?? null;
  const { data, error } = accessToken
    ? await supabase.auth.getUser(accessToken)
    : await supabase.auth.getUser();
  const verifiedAccessToken =
    data.user &&
    accessToken &&
    (!session?.user?.id || session.user.id === data.user.id)
      ? accessToken
      : null;
  return {
    user: data.user,
    accessToken: verifiedAccessToken,
    error: error?.message ?? null,
    configured: true,
  };
}

// AppShell and a protected page render in the same React Server Components
// request. Sharing this promise prevents two concurrent getUser calls from
// racing while Supabase rotates or validates the same auth session.
export const getOpsCurrentUser = cache(loadOpsCurrentUser);
