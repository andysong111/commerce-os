import { runCanonicalEventMismatchEvidence } from "@/lib/canonicalSalesEventMismatchEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await runCanonicalEventMismatchEvidence();
    return Response.json({
      ok: result.state !== "FAILED",
      writesEnabled: false,
      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        state: "FAILED",
        writesEnabled: false,
        code: "CANONICAL_EVENT_MISMATCH_EVIDENCE_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Canonical event mismatch evidence 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
