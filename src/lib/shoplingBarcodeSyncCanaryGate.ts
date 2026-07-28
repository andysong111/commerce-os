import type { ShoplingBarcodeSyncActionsResult } from "./shoplingBarcodeSyncRunner";

export const SHOPLING_BARCODE_SYNC_CANARY_COOKIE = "shopling_barcode_sync_canary";
export const SHOPLING_BARCODE_SYNC_CANARY_GATE_KEYS = [
  "100035",
  "100051",
  "100092",
  "100157",
  "108186",
  "112018",
  "100068",
  "100116",
  "100133",
  "100050",
] as const;

const MAX_CANARY_AGE_MS = 7 * 24 * 60 * 60_000;

export type ShoplingBarcodeSyncCanaryGate =
  | { ok: true; message: string }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function exactVerifiedKeys(value: unknown) {
  if (!Array.isArray(value)) return false;
  const keys = value.filter((item): item is string => typeof item === "string");
  if (keys.length !== SHOPLING_BARCODE_SYNC_CANARY_GATE_KEYS.length) return false;
  return SHOPLING_BARCODE_SYNC_CANARY_GATE_KEYS.every(
    (key, index) => keys[index] === key,
  );
}

export function evaluateShoplingBarcodeSyncCanary(
  result: ShoplingBarcodeSyncActionsResult,
  now = new Date(),
): ShoplingBarcodeSyncCanaryGate {
  if (result.status !== "success" || result.runConclusion !== "success" || !result.summary) {
    return { ok: false, message: "완료된 성공 상태의 10개 테스트 결과가 필요합니다." };
  }

  const summary = result.summary as Record<string, unknown>;
  if (summary.mode !== "canary") {
    return { ok: false, message: "선택한 요청은 10개 테스트 실행이 아닙니다." };
  }
  if (!exactVerifiedKeys(summary.requested_goods_keys)) {
    return { ok: false, message: "검증된 10개 상품과 일치하는 테스트 결과가 아닙니다." };
  }
  if (!Array.isArray(summary.collection_errors) || summary.collection_errors.length !== 0) {
    return { ok: false, message: "10개 테스트 조회 과정에 오류가 있습니다." };
  }
  if (integer(summary.blocked_products) !== 0) {
    return { ok: false, message: "10개 테스트에 구조 차단 상품이 있습니다." };
  }

  const generatedAt = typeof summary.generated_at === "string" ? new Date(summary.generated_at) : null;
  if (
    !generatedAt ||
    !Number.isFinite(generatedAt.getTime()) ||
    generatedAt.getTime() > now.getTime() + 5 * 60_000 ||
    now.getTime() - generatedAt.getTime() > MAX_CANARY_AGE_MS
  ) {
    return { ok: false, message: "10개 테스트 결과가 없거나 7일이 지나 다시 테스트해야 합니다." };
  }

  if (!isRecord(summary.execution)) {
    return { ok: false, message: "10개 테스트 실행 결과가 없습니다." };
  }
  const execution = summary.execution;
  if (
    integer(execution.selected_products) !== 10 ||
    integer(execution.attempted_products) !== 10 ||
    integer(execution.success) !== 10 ||
    integer(execution.failed) !== 0 ||
    integer(execution.unknown) !== 0 ||
    integer(execution.skipped) !== 0 ||
    execution.stopped_early !== false
  ) {
    return {
      ok: false,
      message: "10개 테스트가 전부 성공하지 않았습니다. 전체 반영을 시작할 수 없습니다.",
    };
  }

  return { ok: true, message: "검증된 10개 테스트가 모두 성공했습니다." };
}
