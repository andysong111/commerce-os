import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateShoplingPriceBulkCreateInput } from "@/lib/shoplingPriceModifyBulkServer";

type Result = { data: unknown; error: unknown };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
};
type Admin = { rpc(name: string, parameters: Record<string, unknown>): Promise<Result>; from(table: string): Query };

type SessionResult =
  | { response: NextResponse; ownerId?: never; admin?: never }
  | { ownerId: string; admin: Admin; response?: never };

async function session(): Promise<SessionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { response: NextResponse.json({ error: "Supabase 공개 설정이 필요합니다." }, { status: 503 }) };
    const { data, error } = await supabase.auth.getUser();
    if (error) return { response: NextResponse.json({ error: "로그인 세션을 확인할 수 없습니다." }, { status: 401 }) };
    if (!data.user) return { response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
    const admin = await createSupabaseAdminClient();
    if (!admin) {
      return {
        response: NextResponse.json(
          { error: "Supabase 서버 비밀키 설정이 필요합니다. Vercel의 SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY를 확인하세요." },
          { status: 503 },
        ),
      };
    }
    return { ownerId: data.user.id, admin: admin as Admin };
  } catch {
    return { response: NextResponse.json({ error: "Supabase 서버 연결에 실패했습니다." }, { status: 500 }) };
  }
}

export async function POST(request: Request) {
  try {
    const auth = await session();
    if (auth.response) return auth.response;

    let input;
    try {
      input = validateShoplingPriceBulkCreateInput(await request.json());
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "입력 통계가 일치하지 않습니다." }, { status: 400 });
    }

    const { data, error } = await auth.admin.rpc("create_shopling_price_bulk_prepared_job", {
      p_owner_id: auth.ownerId,
      p_input_source: input.inputSource,
      p_goods_keys: input.goodsKeys,
      p_original_count: input.originalCount,
      p_duplicate_count: input.duplicateCount,
      p_invalid_count: input.invalidCount,
    });
    if (error || !data) return NextResponse.json({ error: "Bulk 작업 저장에 실패했습니다." }, { status: 500 });

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    return NextResponse.json({
      id: row.id,
      status: row.status,
      valid_count: row.valid_count,
      total_chunk_count: row.total_chunk_count,
      canary_size: row.canary_size,
      normal_chunk_count: Number(row.total_chunk_count) - 1,
      created_at: row.created_at,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Bulk 작업 저장 중 서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const auth = await session();
    if (auth.response) return auth.response;

    const { data, error } = await auth.admin.from("shopling_price_bulk_jobs")
      .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,total_chunk_count,created_at,updated_at")
      .eq("owner_id", auth.ownerId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return NextResponse.json({ error: "Bulk 작업 조회에 실패했습니다." }, { status: 500 });
    return NextResponse.json({ jobs: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Bulk 작업 조회 중 서버 오류가 발생했습니다." }, { status: 500 });
  }
}
