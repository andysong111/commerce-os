import { regenerateLatestInternalChinaGroupCostPriceProposal } from "@/lib/internalChinaGroupCostPriceReview";
import { importHistoricalProductGroups } from "@/lib/shopling/historicalProductGroupImport";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "HISTORICAL_GROUP_IMPORT_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 상품그룹 파일을 가져올 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    if (files.length !== 6) {
      throw new Error(`HISTORICAL_GROUP_SIX_FILES_REQUIRED:received=${files.length}`);
    }
    let totalBytes = 0;
    const uploads = [];
    for (const file of files) {
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        throw new Error(`HISTORICAL_GROUP_FILE_SIZE_INVALID:${file.name}:${file.size}`);
      }
      totalBytes += file.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`HISTORICAL_GROUP_TOTAL_SIZE_INVALID:${totalBytes}`);
      }
      uploads.push({
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }

    const imported = await importHistoricalProductGroups(uploads);
    const proposal = await regenerateLatestInternalChinaGroupCostPriceProposal();
    return Response.json(
      {
        ok: true,
        imported,
        proposal: {
          fingerprint: proposal.fingerprint,
          state: proposal.state,
          changedRowCount: proposal.changedRowCount,
          unresolvedGroupCount: proposal.unresolvedGroupCount,
          ruleVersion: proposal.ruleVersion,
        },
        message: `구형 GOODSKEY ${imported.extractedUniqueCount.toLocaleString("ko-KR")}개의 내부 가격그룹을 검증·저장하고 상품그룹 가격조정안을 재산출했습니다. 실제 Shopling 가격은 변경하지 않았습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw =
      error instanceof Error ? error.message : "HISTORICAL_GROUP_IMPORT_FAILED";
    const code = raw.split(":", 1)[0] || "HISTORICAL_GROUP_IMPORT_FAILED";
    const message =
      code === "HISTORICAL_GROUP_FILE_CONFLICT" ||
      code === "HISTORICAL_GROUP_EXISTING_CONFLICT"
        ? "같은 GOODSKEY가 서로 다른 상품그룹으로 발견되어 가져오기를 중단했습니다. 기존 그룹을 덮어쓰지 않았습니다."
        : code === "HISTORICAL_GROUP_SIX_FILES_REQUIRED"
          ? "도매1·도매2·도매3·도매4·소매1·소매2 파일을 정확히 1개씩, 총 6개 선택해주세요. 파일명의 그룹명을 기준으로 가져옵니다."
          : code === "HISTORICAL_GROUP_XLSX_GOODS_KEY_NOT_FOUND"
            ? "선택한 엑셀에서 Shopling GOODSKEY 열을 찾지 못했습니다. 파일을 확인해주세요."
            : raw;
    return Response.json(
      { ok: false, code, message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
