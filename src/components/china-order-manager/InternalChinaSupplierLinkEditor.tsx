"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { InternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";

type ModelLinkRow = {
  modelNo: string;
  modelName: string;
  productName: string;
  barcodes: string[];
  saleOptions: string[];
  initialLink: string;
  linkConflict: boolean;
};

type SaveResult = {
  ok?: boolean;
  message?: string;
  supplierLink?: string;
  savedAt?: string;
  productMasterSynced?: boolean;
  productMasterError?: string;
};

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function modelRows(draft: InternalChinaPurchaseDraft): ModelLinkRow[] {
  const grouped = new Map<
    string,
    {
      modelName: string;
      productName: string;
      barcodes: Set<string>;
      saleOptions: Set<string>;
      links: Set<string>;
    }
  >();
  for (const line of draft.lines) {
    const modelNo = line.modelNo.trim() || line.barcode;
    const current = grouped.get(modelNo) ?? {
      modelName: "",
      productName: "",
      barcodes: new Set<string>(),
      saleOptions: new Set<string>(),
      links: new Set<string>(),
    };
    if (!current.modelName && line.modelName.trim()) {
      current.modelName = line.modelName.trim();
    }
    if (!current.productName && line.productName.trim()) {
      current.productName = line.productName.trim();
    }
    current.barcodes.add(line.barcode);
    if (line.saleOption.trim()) current.saleOptions.add(line.saleOption.trim());
    if (line.supplierLink.trim()) current.links.add(line.supplierLink.trim());
    grouped.set(modelNo, current);
  }
  return [...grouped.entries()]
    .map(([modelNo, value]) => ({
      modelNo,
      modelName: value.modelName,
      productName: value.productName,
      barcodes: [...value.barcodes].sort(),
      saleOptions: [...value.saleOptions],
      initialLink: [...value.links][0] ?? "",
      linkConflict: value.links.size > 1,
    }))
    .sort((left, right) => left.modelNo.localeCompare(right.modelNo, "ko-KR", {
      numeric: true,
      sensitivity: "base",
    }));
}

export function InternalChinaSupplierLinkEditor({
  initialDraft,
}: {
  initialDraft: InternalChinaPurchaseDraft;
}) {
  const router = useRouter();
  const rows = useMemo(() => modelRows(initialDraft), [initialDraft]);
  const [links, setLinks] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.modelNo, row.initialLink])),
  );
  const [savingModel, setSavingModel] = useState("");
  const [messages, setMessages] = useState<
    Record<string, { text: string; failed: boolean }>
  >({});
  const [showAll, setShowAll] = useState(false);

  const visibleRows = showAll
    ? rows
    : rows.filter((row) => !validHttpUrl(links[row.modelNo] ?? ""));
  const missingCount = rows.filter(
    (row) => !validHttpUrl(links[row.modelNo] ?? ""),
  ).length;

  async function save(row: ModelLinkRow) {
    if (initialDraft.status !== "DRAFT" || savingModel) return;
    const supplierLink = (links[row.modelNo] ?? "").trim();
    if (!validHttpUrl(supplierLink)) {
      setMessages((current) => ({
        ...current,
        [row.modelNo]: {
          text: "올바른 http/https 1688 링크를 입력하세요.",
          failed: true,
        },
      }));
      return;
    }

    setSavingModel(row.modelNo);
    setMessages((current) => ({
      ...current,
      [row.modelNo]: {
        text: "상품출시와 상품마스터에 저장 중입니다.",
        failed: false,
      },
    }));
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(initialDraft.draftId)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            action: "UPDATE_MODEL_SUPPLIER_LINK",
            modelNo: row.modelNo,
            supplierLink,
          }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as SaveResult;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "모델 1번 중국링크 저장에 실패했습니다.");
      }
      setLinks((current) => ({
        ...current,
        [row.modelNo]: body.supplierLink || supplierLink,
      }));
      setMessages((current) => ({
        ...current,
        [row.modelNo]: {
          text: body.productMasterSynced
            ? "상품출시 고정 1번 링크와 상품마스터 최신 원장에 저장했습니다."
            : `상품출시에는 저장됐습니다. 상품마스터 동기화 확인 필요: ${body.productMasterError || "재시도 필요"}`,
          failed: !body.productMasterSynced,
        },
      }));
      router.refresh();
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [row.modelNo]: {
          text:
            error instanceof Error
              ? error.message
              : "모델 1번 중국링크 저장에 실패했습니다.",
          failed: true,
        },
      }));
    } finally {
      setSavingModel("");
    }
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-indigo-700">
            BIDIRECTIONAL PURCHASE METADATA
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            모델별 고정 1번 1688 링크 입력·역저장
          </h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
            이 Draft와 상품출시진행관리 양쪽에서 입력할 수 있습니다. 마지막으로 저장한
            모델 링크가 공통 기준값이 되며, 저장 즉시 같은 모델의 모든 B-code와
            상품마스터 최신 구매정보 원장에 반영됩니다. 실제 1688 주문·결제는 실행하지
            않습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://commerce-os-product-master.vercel.app/purchase-metadata"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-black text-indigo-800 hover:bg-indigo-100"
          >
            상품마스터 최신 원장
          </a>
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50"
          >
            {showAll ? `누락 ${missingCount}개만 보기` : `전체 모델 ${rows.length}개 보기`}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="전체 모델" value={`${rows.length}개`} />
        <Metric label="링크 입력 완료" value={`${rows.length - missingCount}개`} />
        <Metric label="링크 입력 필요" value={`${missingCount}개`} danger={missingCount > 0} />
      </div>

      <div className="mt-4 space-y-3">
        {visibleRows.length ? (
          visibleRows.map((row) => {
            const value = links[row.modelNo] ?? "";
            const message = messages[row.modelNo];
            const valid = validHttpUrl(value);
            return (
              <article
                key={row.modelNo}
                className="rounded-xl border border-indigo-200 bg-white p-4"
              >
                <div className="grid gap-3 xl:grid-cols-[minmax(230px,0.85fr)_minmax(420px,2fr)_auto] xl:items-end">
                  <div>
                    <strong className="font-mono text-sm text-slate-950">
                      {row.modelNo}
                    </strong>
                    <span className="mt-1 block font-bold text-slate-800">
                      {row.modelName || row.productName || "모델명 -"}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      B-code {row.barcodes.join(", ")}
                    </span>
                    {row.linkConflict ? (
                      <span className="mt-1 block text-xs font-bold text-rose-700">
                        기존 Draft 안에 서로 다른 링크가 있어 마지막 저장값으로 통일해야 합니다.
                      </span>
                    ) : null}
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-xs font-black text-slate-700">
                      모델 고정 1번 1688 링크
                    </span>
                    <input
                      type="url"
                      value={value}
                      disabled={initialDraft.status !== "DRAFT" || savingModel === row.modelNo}
                      onChange={(event) =>
                        setLinks((current) => ({
                          ...current,
                          [row.modelNo]: event.target.value,
                        }))
                      }
                      placeholder="https://detail.1688.com/offer/..."
                      className={`w-full rounded-xl border px-3 py-2.5 font-mono text-xs outline-none ${
                        valid
                          ? "border-emerald-300 bg-emerald-50 text-emerald-950 focus:border-emerald-500"
                          : "border-amber-300 bg-amber-50 text-amber-950 focus:border-amber-500"
                      }`}
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    {valid ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-sm font-black text-emerald-800 hover:bg-emerald-50"
                      >
                        1688 열기
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void save(row)}
                      disabled={
                        initialDraft.status !== "DRAFT" ||
                        Boolean(savingModel) ||
                        !valid
                      }
                      className="rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {savingModel === row.modelNo
                        ? "양방향 저장 중..."
                        : "공통 기준으로 저장"}
                    </button>
                  </div>
                </div>

                {message ? (
                  <p
                    className={`mt-3 text-xs font-bold ${
                      message.failed ? "text-rose-700" : "text-emerald-700"
                    }`}
                  >
                    {message.text}
                  </p>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-bold text-emerald-900">
            모든 모델의 고정 1번 1688 링크가 준비됐습니다. 전체 모델 보기를 누르면 기존 링크도 수정할 수 있습니다.
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <article className="rounded-xl border border-white/80 bg-white px-4 py-3 shadow-sm">
      <span className="block text-xs font-bold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block text-xl font-black ${
          danger ? "text-rose-700" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </article>
  );
}
