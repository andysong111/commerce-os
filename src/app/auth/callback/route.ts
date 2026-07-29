import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeOpsAuthRedirect } from "@/lib/supabase/session";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = getSafeOpsAuthRedirect(url.searchParams.get("next"));
  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(nextPath, request.url));
}
