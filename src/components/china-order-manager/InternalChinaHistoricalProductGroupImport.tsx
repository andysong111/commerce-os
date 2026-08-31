"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const REQUIRED_GROUPS = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"] as const;

export function InternalChinaHistoricalProductGroupImport() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const coverage = useMemo(() => {
    const names = files.map((file) => file.name.normalize("NFKC"));
    return REQUIRED_GROUPS.map((group) => ({
      group,
      count: names.filter((name) => name.includes(group)).length,
    }));
  }, [files]);
  const ready =
    files.length === 6 && coverage.every((row) => row.count === 1) && !saving;

  async function upload() {
    if (!ready) return;
    if (
      !window.confirm(
        "선택한 6개 엑셀의 파일명(도매1~소매2)을 권위 있는 내부 가격그룹으로 사용해 구형 GOODSKEY를 한 번 백필할까요?\n\n기존 GOODSKEY가 다른 그룹으로 저장돼 있으면 덮어쓰지 않고 전체 작업을 중단합니다. 실제 Shopling 상품그룹이나 판매가격은 변경하지 않습니다.",
      )
    ) {
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const data = new FormData();
      files.forEach((file) => data.append("files", file));
      const response = await fetch(
        "/api/china-order-manager/price-review/product-groups/import",
        {
          method: "POST",
          body: data,
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        imported?: {
          extractedUniqueCount?: number;
          insertedCount?: number;
          alreadySameCount?: number;
        };
        proposal?: { unresolvedGroupCount?: number; changedRowCount?: number };
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `상품그룹 가져오기 실패 (${response.status})`);
      }
      const imported = body.imported ?? {};
      const proposal = body.proposal ?? {};
      setNotice(
        `${body.message || "상품그룹을 가져왔습니다."} · 신규 저장 ${(imported.insertedCount ?? 0).toLocaleString("ko-KR")}건 · 기존 동일 ${(imported.alreadySameCount ?? 0).toLocaleString("ko-KR")}건 · 현재 미확정 그룹 ${(proposal.unresolvedGroupCount ?? 0).toLocaleString("ko-KR")}건`,
      );
      setFiles([]);
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "구형 상품그룹 파일을 가져오지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-4xl">
          <span className="text-xs font-black tracking-[0.14em] text-amber-800">
            ONE-TIME LEGACY GOODSKEY GROUP BACKFILL
          </span>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            기존상품 상품그룹 1회 가져오기
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            신규 SEO 대량등록 상품은 Shopling 상품그룹을 계속 미지정으로 둡니다. 이 도구는 과거 상품만 대상으로 하며 파일명의 도매1~도매4·소매1~소매2를 OPS 내부 가격정책용 그룹으로 영구 저장합니다. Shopling의 상품그룹 필드는 수정하지 않습니다.
          </p>
        </div>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          disabled={saving}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          className="max-w-[340px] rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs"
        />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {coverage.map((row) => (
          <div
            key={row.group}
            className={`rounded-lg border px-3 py-2 text-xs font-bold ${row.count === 1 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-white text-amber-900"}`}
          >
            {row.group} · {row.count === 1 ? "확인" : `${row.count}개`}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready}
          onClick={upload}
          className="rounded-xl bg-amber-900 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "그룹 백필·가격안 재산출 중..." : "6개 파일 그룹 백필 · 가격안 재산출"}
        </button>
        <span className="text-xs text-amber-900">
          파일은 정확히 6개 · 각 파일명에 그룹명 1개 · 충돌 시 자동 중단
        </span>
      </div>
      {notice ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
