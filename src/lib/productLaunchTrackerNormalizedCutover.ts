import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  countProductLaunchNormalizedRows,
  isProductLaunchNormalizedFresh,
  prepareProductLaunchNormalizedSnapshot,
  readProductLaunchNormalizedWorkspace,
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type StoredRow = { state_payload?: unknown; updated_at?: unknown };

export async function runProductLaunchNormalizedCutover(
  request: NextRequest,
  action: "audit" | "apply" | "disable",
) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  if (action === "disable") {
    await setProductLaunchNormalizedReadEnabled(
      config.value,
      identity.value.userId,
      false,
    );
    return Response.json({ ok: true, disabled: true });
  }

  const row = (await readProductLaunchState(
    config.value,
    identity.value.userId,
  )) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) {
    return Response.json(
      { ok: false, code: "PRODUCT_LAUNCH_STATE_NOT_FOUND", message: "상품출시진행관리 원본을 찾지 못했습니다." },
      { status: 404 },
    );
  }

  const state = row.state_payload as ProductLaunchTrackerState;
  const expected = prepareProductLaunchNormalizedSnapshot(
    state,
    identity.value,
    row.updated_at,
    false,
  );

  if (action === "apply") {
    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      state,
      row.updated_at,
      { readEnabled: false, backfilledAt: new Date().toISOString() },
    );
  }

  const counts = await countProductLaunchNormalizedRows(
    config.value,
    identity.value.userId,
  );
  const countMatch =
    counts.itemCount === expected.itemCount &&
    counts.optionCount === expected.optionCount;
  if (action === "apply" && !countMatch) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_NORMALIZED_COUNT_MISMATCH",
        message: "정규화 DB 행 수가 원본과 일치하지 않아 전환을 중단했습니다.",
        expected: { itemCount: expected.itemCount, optionCount: expected.optionCount },
        actual: counts,
      },
      { status: 409 },
    );
  }

  if (action === "apply") {
    await setProductLaunchNormalizedReadEnabled(
      config.value,
      identity.value.userId,
      true,
    );
  }
  const workspace = await readProductLaunchNormalizedWorkspace(
    config.value,
    identity.value.userId,
  );
  const fresh = isProductLaunchNormalizedFresh(workspace, row.updated_at);

  return Response.json({
    ok: true,
    applied: action === "apply",
    ready: countMatch && fresh,
    readEnabled: workspace?.normalized_read_enabled === true,
    fresh,
    expected: { itemCount: expected.itemCount, optionCount: expected.optionCount },
    actual: counts,
    sourceStateUpdatedAt: nullableText(row.updated_at),
    normalizedStateUpdatedAt: nullableText(workspace?.source_state_updated_at),
  });
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
