import { after, NextRequest } from "next/server";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import {
  createMarketAutoOrchestration,
  heartbeatMarketAutoAgent,
  listMarketAutoOrchestrations,
  MARKET_AUTO_AGENT_BRIDGE,
  pollMarketAutoAgent,
  reportMarketAutoAgent,
  validMarketAutoAgentId,
  validMarketAutoToken,
} from "@/lib/shoplingMarketAutoOrchestrationServer";
import { runCoalescedSeoRunShoplingWorkerPulse } from "@/lib/seoRunShoplingWorkerPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
function text(value: unknown) {
  return String(value ?? "").trim();
}

async function wakeShoplingWorker(userId: string) {
  await wakeOpsDispatchTask("seo-run-worker", 0).catch(() => false);
  await runCoalescedSeoRunShoplingWorkerPulse({
    workerId: `one-click:${userId.slice(0, 8)}:${crypto.randomUUID()}`,
    leaseSeconds: 150,
  }).catch((error) => {
    console.error("[shopling-market-auto] Shopling registration worker failed", error);
  });
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  try {
    const orchestrations = await listMarketAutoOrchestrations(
      authenticated.value.identity.userId,
    );
    return Response.json({ ok: true, orchestrations });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "market_auto_list_failed",
        message: error instanceof Error ? error.message : "원클릭 상태 조회 실패",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action) || "create";

  if (["agent_poll", "agent_heartbeat", "agent_report"].includes(action)) {
    if (text(body.bridge) !== MARKET_AUTO_AGENT_BRIDGE) {
      return Response.json(
        { ok: false, error: "unsupported_market_auto_agent_bridge" },
        { status: 400 },
      );
    }
    const token = validMarketAutoToken(body.token);
    const agentId = validMarketAutoAgentId(body.agentId);
    if (!token || !agentId) {
      return Response.json(
        { ok: false, error: "invalid_market_auto_agent_identity" },
        { status: 400 },
      );
    }
    try {
      const result =
        action === "agent_poll"
          ? await pollMarketAutoAgent(token, agentId)
          : action === "agent_heartbeat"
            ? await heartbeatMarketAutoAgent(token, agentId)
            : await reportMarketAutoAgent(token, agentId);
      return Response.json({ ok: true, bridge: MARKET_AUTO_AGENT_BRIDGE, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "market auto agent failed";
      const status = message.includes("not_found") ? 404 : message.includes("lease_mismatch") ? 409 : 503;
      return Response.json({ ok: false, error: message }, { status });
    }
  }

  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  if (action !== "create") {
    return Response.json({ ok: false, error: "unsupported_market_auto_action" }, { status: 400 });
  }
  try {
    const created = await createMarketAutoOrchestration(
      authenticated.value,
      body.runIds,
    );
    if (created.needsWorkerWake) {
      after(() => wakeShoplingWorker(authenticated.value.identity.userId));
    }
    return Response.json({
      ok: true,
      ...created,
      message:
        "Shopling 업로드 → 마켓전송 원클릭 작업을 만들었습니다. v0.3.30 브라우저 에이전트가 이후 단계를 자동으로 이어갑니다.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "원클릭 작업 생성 실패";
    return Response.json(
      { ok: false, error: "market_auto_create_failed", message },
      { status: message.includes("없습니다") ? 409 : 503 },
    );
  }
}
