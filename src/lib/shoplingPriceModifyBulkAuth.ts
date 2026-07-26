import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireBulkOperator() {
  const client = await createSupabaseServerClient();
  const { data } = client ? await client.auth.getUser() : { data: { user: null } };
  if (!data.user) return { response: NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 }) };
  const allowlist = (process.env.OPS_OWNER_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!allowlist.length) return { response: NextResponse.json({ message: "OPS_OWNER_EMAILS가 설정되지 않았습니다." }, { status: 503 }) };
  if (!data.user.email || !allowlist.includes(data.user.email.trim().toLowerCase())) return { response: NextResponse.json({ message: "Bulk 실행 권한이 없습니다." }, { status: 403 }) };
  return { user: data.user };
}
