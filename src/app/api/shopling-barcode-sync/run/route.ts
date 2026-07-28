import { NextResponse } from "next/server";
import {
  dispatchShoplingBarcodeSyncActions,
  type ShoplingBarcodeSyncApplyScope,
  type ShoplingBarcodeSyncMode,
} from "@/lib/shoplingBarcodeSyncRunner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    mode?: unknown;
    apply_scope?: unknown;
    target_goods_keys?: unknown;
    confirm_text?: unknown;
    canary_count?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  const result = await dispatchShoplingBarcodeSyncActions({
    mode: typeof body.mode === "string" ? (body.mode as ShoplingBarcodeSyncMode) : ("" as ShoplingBarcodeSyncMode),
    apply_scope:
      typeof body.apply_scope === "string"
        ? (body.apply_scope as ShoplingBarcodeSyncApplyScope)
        : undefined,
    target_goods_keys: typeof body.target_goods_keys === "string" ? body.target_goods_keys : "",
    confirm_text: typeof body.confirm_text === "string" ? body.confirm_text : "",
    canary_count: typeof body.canary_count === "number" ? body.canary_count : 10,
  });

  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
