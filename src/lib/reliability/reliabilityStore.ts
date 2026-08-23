import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeReliabilityEvent,
  type ReliabilityEventInput,
} from "@/lib/reliability/reliabilityEvent";

export type ReliabilityIngestResult = {
  ok: boolean;
  duplicate?: boolean;
  event_row_id?: string | null;
  incident_id?: string | null;
  occurrence_count?: number;
};

function firstRow(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function ingestReliabilityEvent(input: ReliabilityEventInput) {
  const event = normalizeReliabilityEvent(input);
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    throw new Error("OPS CENTER Supabase 관리자 연결이 설정되지 않았습니다.");
  }

  const result = await admin.rpc("ingest_reliability_event", {
    p_event: event,
  });
  if (result.error) {
    throw new Error(`신뢰성 이벤트를 저장하지 못했습니다: ${result.error.message}`);
  }

  const payload = firstRow(result.data);
  if (!payload || typeof payload !== "object") {
    throw new Error("신뢰성 이벤트 저장 결과가 비어 있습니다.");
  }
  return payload as ReliabilityIngestResult;
}
