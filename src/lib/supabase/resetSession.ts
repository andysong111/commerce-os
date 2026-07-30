import "server-only";

import { cookies } from "next/headers";
import {
  getOpsAuthCookieOptions,
  isOpsAuthCookieName,
} from "@/lib/supabase/session";

export async function clearOpsAuthCookiesBeforeSignIn() {
  const cookieStore = await cookies();
  const cookieOptions = getOpsAuthCookieOptions();
  const options = {
    path: cookieOptions.path,
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
    maxAge: 0,
  };

  for (const cookie of cookieStore.getAll()) {
    if (!isOpsAuthCookieName(cookie.name)) continue;
    cookieStore.set(cookie.name, "", options);
  }
}
