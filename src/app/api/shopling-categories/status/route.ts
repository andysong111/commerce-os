import { NextRequest } from "next/server";
import { fetchShoplingCategoryRefreshStatus } from "@/lib/shoplingCategoryCatalog";
import { fetchShoplingCategoryRunState } from "@/lib/shoplingCategoryRunStatus";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

const CATEGORY_RUN_COOKIE = "commerce_os_shopling_category_run";
const TERMINAL_STORED_STATUSES = new Set([
  "success",
  "failed",
  "manual_login_required",
  "cancelled",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function parseRunIdentity(request: NextRequest) {
  const queryRequestId = text(request.nextUrl.searchParams.get("requestId"));
  const queryStartedAt = text(request.nextUrl.searchParams.get("startedAt"));
  if (queryRequestId || queryStartedAt) {
    return { requestId: queryRequestId, startedAt: queryStartedAt };
  }

  const rawCookie = request.cookies.get(CATEGORY_RUN_COOKIE)?.value;
  if (!rawCookie) return { requestId: "", startedAt: "" };
  try {
    const parsed = JSON.parse(decodeURIComponent(rawCookie)) as {
      requestId?: unknown;
      startedAt?: unknown;
    };
    return {
      requestId: text(parsed.requestId),
      startedAt: text(parsed.startedAt),
    };
  } catch {
    return { requestId: "", startedAt: "" };
  }
}

function isSnapshotFresh(
  snapshot: { collectedAt?: string } | null | undefined,
  startedAt: string,
) {
  const snapshotAt = Date.parse(snapshot?.collectedAt || "");
  const started = Date.parse(startedAt || "");
  return (
    Number.isFinite(snapshotAt) &&
    Number.isFinite(started) &&
    snapshotAt >= started - 2_000
  );
}

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }
  try {
    const runIdentity = parseRunIdentity(request);
    const [stored, run] = await Promise.all([
      fetchShoplingCategoryRefreshStatus(),
      fetchShoplingCategoryRunState(runIdentity).catch(() => null),
    ]);

    const storedStatus = text(stored.status?.status);
    const storedRequestId = text(stored.status?.requestId);
    const sameStoredRequest =
      Boolean(runIdentity.requestId) &&
      storedRequestId === runIdentity.requestId;
    const freshSnapshot = isSnapshotFresh(
      stored.snapshot,
      runIdentity.startedAt,
    );
    const storedTerminal =
      TERMINAL_STORED_STATUSES.has(storedStatus) &&
      (!runIdentity.requestId || sameStoredRequest || freshSnapshot);

    if (storedTerminal) {
      return Response.json(
        { ok: true, ...stored, run },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (run?.active) {
      return Response.json(
        {
          ok: true,
          ...stored,
          status: {
            ...stored.status,
            status: "running",
            requestId: runIdentity.requestId || storedRequestId,
            checkedAt: run.updatedAt || run.createdAt,
            message:
              "GitHub Actions에서 샵플링 표준카테고리를 업데이트하고 있습니다.",
          },
          run,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (run?.terminal) {
      const conclusion = text(run.conclusion).toLowerCase();
      if (conclusion === "success") {
        return Response.json(
          {
            ok: true,
            ...stored,
            status: {
              ...stored.status,
              status: "failed",
              requestId: runIdentity.requestId || storedRequestId,
              checkedAt: run.updatedAt || run.createdAt,
              message:
                "GitHub Actions는 성공으로 종료됐지만 카테고리 스냅샷이 main에 저장되지 않았습니다. 업데이트를 다시 실행하세요.",
            },
            run,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (conclusion === "cancelled") {
        return Response.json(
          {
            ok: true,
            ...stored,
            status: {
              ...stored.status,
              status: "cancelled",
              requestId: runIdentity.requestId || storedRequestId,
              checkedAt: run.updatedAt || run.createdAt,
              message: "샵플링 카테고리 업데이트가 취소됐습니다.",
            },
            run,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      return Response.json(
        {
          ok: true,
          ...stored,
          status: {
            ...stored.status,
            status: "failed",
            requestId: runIdentity.requestId || storedRequestId,
            checkedAt: run.updatedAt || run.createdAt,
            message: `GitHub Actions 카테고리 업데이트가 ${conclusion || "실패"} 상태로 종료됐습니다.`,
          },
          run,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { ok: true, ...stored, run },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "카테고리 상태 확인 실패",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
