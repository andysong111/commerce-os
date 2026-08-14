"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { InternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import type {
  InternalChinaPurchaseDraft,
  InternalChinaPurchaseDraftLine,
} from "@/lib/internalChinaPurchaseDraft";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const cny = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function lineKey(line: InternalChinaPurchaseDraftLine) {
  return line.freightGroupId.trim() || `__${line.barcode}`;
}

function modelKey(line: Pick<InternalChinaPurchaseDraftLine, "modelNo" | "barcode">) {
  return line.modelNo.trim().toUpperCase() || line.barcode.trim().toUpperCase();
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type DraftSaveResponse = {
  ok?: boolean;
  message?: string;
  draft?: InternalChinaPurchaseDraft;
};

type MetadataSyncResponse = DraftSaveResponse & {
  productMasterSynced?: boolean;
  productMasterError?: string | null;
  warnings?: string[];
  syncedModels?: number;
  syncedBcodes?: number;
};

export function InternalChinaPurchaseDraftWorkspaceV2({
  initialDraft,
  budgetAudit,
}: {
  initialDraft: InternalChinaPurchaseDraft;
  budgetAudit: InternalChinaPurchaseBudgetAudit;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(1900);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tableScroll = tableScrollRef.current;
    const topScroll = topScrollRef.current;
    if (!tableScroll || !topScroll) return;

    const measure = () => {
      const table = tableScroll.querySelector("table");
      setScrollWidth(Math.max(table?.scrollWidth ?? 0, tableScroll.clientWidth));
    };
    const syncFromTop = () => {
      if (tableScroll.scrollLeft !== topScroll.scrollLeft) {
        tableScroll.scrollLeft = topScroll.scrollLeft;
      }
    };
    const syncFromTable = () => {
      if (topScroll.scrollLeft !== tableScroll.scrollLeft) {
        topScroll.scrollLeft = tableScroll.scrollLeft;
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tableScroll);
    const table = tableScroll.querySelector("table");
    if (table) observer.observe(table);
    topScroll.addEventListener("scroll", syncFromTop, { passive: true });
    tableScroll.addEventListener("scroll", syncFromTable, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      topScroll.removeEventListener("scroll", syncFromTop);
      tableScroll.removeEventListener("scroll", syncFromTable);
      window.removeEventListener("resize", measure);
    };
  }, [draft.lines.length]);

  const calculations = useMemo(() => {
    const groups = new Map<string, { quantity: number; freight: number }>();
    for (const line of draft.lines) {
      const key = lineKey(line);
      const current = groups.get(key) ?? { quantity: 0, freight: 0 };
      current.quantity += line.quantity;
      current.freight += decimal(line.domesticChinaFreightCny);
      groups.set(key, current);
    }

    const byBarcode = new Map<
      string,
      {
        freightPerUnitCny: number;
        finalUnitCny: number;
        actualUnitKrw: number;
        internalStandardUnitKrw: number;
      }
    >();
    let productCny = 0;
    let freightCny = 0;
    let totalKrw = 0;
    let internalStandardTotalKrw = 0;

    for (const line of draft.lines) {
      const group = groups.get(lineKey(line)) ?? { quantity: 0, freight: 0 };
      const freightPerUnitCny =
        group.quantity > 0 ? group.freight / group.quantity : 0;
      const finalUnitCny = decimal(line.unitPriceCny) + freightPerUnitCny;
      const actualUnitKrw = finalUnitCny * draft.exchangeRateKrwPerCny;
      const rowTotalKrw = actualUnitKrw * line.quantity;
      const internalStandardUnitKrw =
        actualUnitKrw * draft.internalOrderCostMultiplier;
      byBarcode.set(line.barcode, {
        freightPerUnitCny,
        finalUnitCny,
        actualUnitKrw,
        internalStandardUnitKrw,
      });
      productCny += decimal(line.unitPriceCny) * line.quantity;
      totalKrw += rowTotalKrw;
      internalStandardTotalKrw +=
        rowTotalKrw * draft.internalOrderCostMultiplier;
    }
    freightCny = [...groups.values()].reduce(
      (sum, group) => sum + group.freight,
      0,
    );
    const productKrw = productCny * draft.exchangeRateKrwPerCny;
    const budgetKrw = budgetAudit.productOrderBudgetKrw;
    const budgetUsedPercent =
      budgetKrw > 0 ? Math.round((productKrw / budgetKrw) * 10_000) / 100 : 0;
    return {
      byBarcode,
      productCny,
      productKrw,
      freightCny,
      totalKrw,
      internalStandardTotalKrw,
      budgetUsedPercent,
      budgetRemainingKrw: Math.max(0, budgetKrw - productKrw),
      budgetOverKrw: Math.max(0, productKrw - budgetKrw),
      actualPriceCount: draft.lines.filter((line) => decimal(line.unitPriceCny) > 0)
        .length,
    };
  }, [budgetAudit.productOrderBudgetKrw, draft]);

  const requiredIssues = useMemo(() => {
    const issues: string[] = [];
    for (const line of draft.lines) {
      if (line.unitPriceCny <= 0) issues.push(`${line.barcode} 위안단가`);
      if (!validHttpUrl(line.supplierLink)) {
        issues.push(`${line.barcode} 모델 1번 1688 링크`);
      }
      if (!line.chinaOption.trim()) issues.push(`${line.barcode} 중국옵션`);
    }
    return issues;
  }, [draft.lines]);

  const optionReviewCount = useMemo(
    () => draft.lines.filter((line) => !line.chinaOption.trim()).length,
    [draft.lines],
  );

  function updateLine(
    barcode: string,
    patch: Partial<InternalChinaPurchaseDraftLine>,
  ) {
    if (draft.status !== "DRAFT") return;
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.barcode === barcode ? { ...line, ...patch } : line,
      ),
    }));
  }

  function updateModelSupplierLink(
    source: Pick<InternalChinaPurchaseDraftLine, "modelNo" | "barcode">,
    supplierLink: string,
  ) {
    if (draft.status !== "DRAFT") return;
    const target = modelKey(source);
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        modelKey(line) === target ? { ...line, supplierLink } : line,
      ),
    }));
  }

  function payload(sourceDraft = draft) {
    return {
      lines: sourceDraft.lines.map((line) => ({
        barcode: line.barcode,
        modelNo: line.modelNo,
        quantity: line.quantity,
        chinaOption: line.chinaOption,
        supplierLink: line.supplierLink,
        unitPriceCny: line.unitPriceCny,
        freightGroupId: line.freightGroupId,
        domesticChinaFreightCny: line.domesticChinaFreightCny,
        orderNumber: line.orderNumber,
        note: line.note,
      })),
    };
  }

  async function persistDraft(options: { quiet?: boolean } = {}) {
    const response = await fetch(
      `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload()),
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    const body = (await response.json().catch(() => ({}))) as DraftSaveResponse;
    if (!response.ok || !body.ok || !body.draft) {
      throw new Error(body.message || "중국 발주초안 저장에 실패했습니다.");
    }

    let nextDraft = body.draft;
    let metadataMessage = "";
    try {
      const metadataResponse = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}/purchase-metadata`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload(nextDraft)),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const metadata = (await metadataResponse.json().catch(() => ({}))) as MetadataSyncResponse;
      if (!metadataResponse.ok || !metadata.ok) {
        throw new Error(
          metadata.message ||
            "Draft는 저장됐지만 상품출시진행관리 역저장을 완료하지 못했습니다.",
        );
      }
      if (metadata.draft) nextDraft = metadata.draft;
      const warnings = metadata.warnings?.filter(Boolean) ?? [];
      metadataMessage = metadata.productMasterSynced
        ? `상품출시진행관리와 상품마스터 최신 원장에 양방향 반영했습니다. 모델 ${metadata.syncedModels ?? 0}개 · B-code ${metadata.syncedBcodes ?? 0}개.`
        : `상품출시진행관리에는 반영했지만 상품마스터 동기화 확인이 필요합니다: ${metadata.productMasterError || warnings.join(" · ") || "재시도 필요"}`;
    } catch (error) {
      metadataMessage =
        error instanceof Error
          ? `Draft는 저장됐지만 구매정보 역저장은 확인이 필요합니다: ${error.message}`
          : "Draft는 저장됐지만 구매정보 역저장은 확인이 필요합니다.";
    }

    setDraft(nextDraft);
    if (!options.quiet) {
      setNotice(`발주초안을 저장했습니다. ${metadataMessage}`);
    }
    router.refresh();
    return nextDraft;
  }

  async function saveDraft() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    setSaving(true);
    try {
      await persistDraft();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "중국 발주초안 저장 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function markOrdered() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    if (requiredIssues.length) {
      setNotice(
        `실제 주문완료 기록 전에 필수값 ${requiredIssues.length}개를 채우세요. ${requiredIssues
          .slice(0, 6)
          .join(" · ")}`,
      );
      return;
    }
    if (
      !window.confirm(
        `실제로 1688에서 ${draft.lineCount}개 SKU · 총 ${draft.totalQuantity.toLocaleString("ko-KR")}개 주문을 완료했습니까?\n\n이 버튼은 1688 주문·결제를 실행하지 않습니다. 실제 주문이 끝난 뒤에만 Ops Center 원장을 ORDERED로 기록합니다.`,
      )
    ) {
      return;
    }
    setOrdering(true);
    try {
      const savedDraft = await persistDraft({ quiet: true });
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ action: "MARK_ORDERED", prep: payload(savedDraft) }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as DraftSaveResponse;
      if (!response.ok || !body.ok || !body.draft) {
        throw new Error(body.message || "실제 주문완료 기록에 실패했습니다.");
      }
      setDraft(body.draft);
      setNotice(body.message || "실제 주문완료로 원장에 기록했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "실제 주문완료 기록 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setOrdering(false);
    }
  }

  function scrollTable(direction: -1 | 1) {
    const target = tableScrollRef.current;
    if (!target) return;
    target.scrollBy({
      left: direction * Math.max(360, Math.round(target.clientWidth * 0.78)),
      behavior: "smooth",
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={draft.status === "ORDERED" ? "실주문 기록" : "주문 준비"} />
        <Metric label="SKU" value={`${number.format(draft.lineCount)}개`} />
        <Metric label="총 주문수량" value={`${number.format(draft.totalQuantity)}개`} />
        <Metric label="필수 확인" value={`${number.format(requiredIssues.length)}건`} danger={requiredIssues.length > 0} />
        <Metric label="내부기준원가" value={`${number.format(Math.round(calculations.internalStandardTotalKrw))}원`} emphasized />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">OPS CENTER NATIVE · BIDIRECTIONAL</span>
            <h2 className="mt-1 text-xl font-black text-slate-950">실제 1688 주문 준비</h2>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
              링크와 중국옵션은 이 표에서 바로 입력할 수 있습니다. `발주초안 저장`을 누르면 모델 고정 1번 링크와 B-code별 중국옵션이 상품출시진행관리로 역저장되고 상품마스터 최신 구매정보 원장에도 반영됩니다. 같은 모델의 링크는 모든 B-code에 즉시 공통 적용됩니다. 수량은 RESERVED 기준값이라 변경하지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[230px] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <span className="block text-xs font-bold text-emerald-700">내부기준원가</span>
              <strong className="mt-0.5 block text-right text-base font-black text-emerald-950">
                {number.format(Math.round(calculations.internalStandardTotalKrw))}원
              </strong>
              <span className="mt-0.5 block text-[11px] text-emerald-700">실주문 원가 × 내부 주문 수수료율 {draft.internalOrderCostMultiplier.toFixed(2)}</span>
            </div>
            <a href="https://commerce-os-product-master.vercel.app/purchase-metadata" target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">
              상품마스터 최신 원장
            </a>
            <button type="button" onClick={() => void saveDraft()} disabled={saving || draft.status !== "DRAFT"} className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "양방향 저장 중..." : "발주초안 저장"}
            </button>
            <button type="button" onClick={() => void markOrdered()} disabled={ordering || draft.status !== "DRAFT" || requiredIssues.length > 0} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              {draft.status === "ORDERED" ? "실주문 기록완료" : ordering ? "기록 중..." : "1688 주문완료 후 기록"}
            </button>
          </div>
        </div>

        {notice ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">{notice}</div> : null}
        {draft.metadataWarnings.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">{draft.metadataWarnings.slice(0, 4).join(" · ")}</div> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SubMetric label="상품금액" value={`${cny.format(calculations.productCny)} CNY`} />
          <SubMetric label="중국내 운임" value={`${cny.format(calculations.freightCny)} CNY`} />
          <SubMetric label="실주문 원가" value={`${number.format(Math.round(calculations.totalKrw))}원`} />
          <SubMetric label="중국옵션 확인 필요" value={`${number.format(optionReviewCount)} SKU`} />
        </div>

        <div className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-5 ${calculations.budgetOverKrw > 0 ? "border-rose-300 bg-rose-50 text-rose-950" : "border-blue-200 bg-blue-50 text-blue-950"}`}>
          <strong>실시간 월간 발주예산 검증</strong> · 실제 위안단가 입력 완료 {calculations.actualPriceCount}/{draft.lineCount} SKU · 현재 입력 상품대금 {number.format(Math.round(calculations.productKrw))}원 · 상품대금 한도 {number.format(budgetAudit.productOrderBudgetKrw)}원 · 사용률 {calculations.budgetUsedPercent.toLocaleString("ko-KR")}% · {calculations.budgetOverKrw > 0 ? `초과 ${number.format(Math.round(calculations.budgetOverKrw))}원` : `잔여 ${number.format(Math.round(calculations.budgetRemainingKrw))}원`}.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="sticky top-0 z-30 rounded-t-2xl border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => scrollTable(-1)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">← 왼쪽</button>
            <div ref={topScrollRef} className="h-4 min-w-0 flex-1 overflow-x-auto overflow-y-hidden rounded bg-slate-100" aria-label="표 좌우 스크롤">
              <div style={{ width: scrollWidth, height: 1 }} />
            </div>
            <button type="button" onClick={() => scrollTable(1)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">오른쪽 →</button>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">위 스크롤바 또는 좌우 버튼으로 표를 이동할 수 있습니다. 아래 기본 가로 스크롤바와 위치가 동기화됩니다.</p>
        </div>

        <div ref={tableScrollRef} className="overflow-x-auto overscroll-x-contain">
          <table className="min-w-[2200px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">B-code / 모델 / 옵션</th>
                <th className="px-3 py-3">중국옵션 · 역저장</th>
                <th className="px-3 py-3">모델 고정 1번 1688 링크 · 역저장</th>
                <th className="px-3 py-3 text-right">수량</th>
                <th className="px-3 py-3 text-right">위안단가</th>
                <th className="px-3 py-3">운임그룹</th>
                <th className="px-3 py-3 text-right">중국내 운임</th>
                <th className="px-3 py-3 text-right">개당 운임</th>
                <th className="px-3 py-3 text-right">최종단가 CNY</th>
                <th className="px-3 py-3 text-right">실주문원가 KRW</th>
                <th className="px-3 py-3 text-right">내부기준원가 KRW</th>
                <th className="px-3 py-3">1688 주문번호</th>
                <th className="px-3 py-3">메모</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.lines.map((line) => {
                const calc = calculations.byBarcode.get(line.barcode)!;
                const editable = draft.status === "DRAFT";
                const linkValid = validHttpUrl(line.supplierLink);
                return (
                  <tr key={line.barcode} className="align-top hover:bg-slate-50/70">
                    <td className="min-w-[280px] px-3 py-3">
                      <strong className="font-mono text-sm text-slate-950">{line.barcode}</strong>
                      <span className="mt-1 block font-semibold text-slate-700">{line.modelName || "모델명 -"}</span>
                      <span className="mt-1 block font-mono text-[11px] text-slate-400">{line.modelNo}</span>
                      <span className="mt-2 inline-flex rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-800">옵션 · {line.saleOption || "-"}</span>
                    </td>
                    <td className="min-w-[240px] px-2 py-2">
                      <Input value={line.chinaOption} disabled={!editable} required={!line.chinaOption.trim()} placeholder="1688 실제 중국옵션명" onChange={(value) => updateLine(line.barcode, { chinaOption: value })} />
                      <span className="mt-1 block text-[10px] font-bold text-indigo-700">저장 시 해당 B-code로 상품출시·상품마스터에 역저장</span>
                    </td>
                    <td className="min-w-[460px] px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Input value={line.supplierLink} type="url" disabled={!editable} required={!linkValid} placeholder="https://detail.1688.com/offer/..." onChange={(value) => updateModelSupplierLink(line, value)} mono />
                        {linkValid ? <a href={line.supplierLink} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-2 font-black text-emerald-800 hover:bg-emerald-50">1688 열기</a> : null}
                      </div>
                      <span className="mt-1 block text-[10px] font-bold text-indigo-700">같은 모델 모든 B-code에 공통 적용 · 저장 시 상품출시 1번 링크로 역저장</span>
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-black text-slate-950">{number.format(line.quantity)}</td>
                    <td className="px-2 py-2"><NumberInput value={line.unitPriceCny} disabled={!editable} required={line.unitPriceCny <= 0} onChange={(value) => updateLine(line.barcode, { unitPriceCny: value })} /></td>
                    <td className="px-2 py-2"><Input value={line.freightGroupId} disabled={!editable} placeholder="같은 공급처면 동일 그룹" onChange={(value) => updateLine(line.barcode, { freightGroupId: value })} /></td>
                    <td className="px-2 py-2"><NumberInput value={line.domesticChinaFreightCny} disabled={!editable} onChange={(value) => updateLine(line.barcode, { domesticChinaFreightCny: value })} /></td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-600">{cny.format(calc.freightPerUnitCny)}</td>
                    <td className="px-3 py-3 text-right font-black text-emerald-800">{cny.format(calc.finalUnitCny)}</td>
                    <td className="px-3 py-3 text-right font-black text-blue-800">{number.format(Math.round(calc.actualUnitKrw))}원</td>
                    <td className="px-3 py-3 text-right font-black text-violet-800">{number.format(Math.round(calc.internalStandardUnitKrw))}원</td>
                    <td className="px-2 py-2"><Input value={line.orderNumber} disabled={!editable} placeholder="1688 주문번호" onChange={(value) => updateLine(line.barcode, { orderNumber: value })} /></td>
                    <td className="min-w-[260px] px-2 py-2"><Input value={line.note} disabled={!editable} placeholder="주문·옵션 특이사항" onChange={(value) => updateLine(line.barcode, { note: value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, emphasized = false, danger = false }: { label: string; value: string; emphasized?: boolean; danger?: boolean }) {
  return <article className={`rounded-xl border px-4 py-3 ${emphasized ? "border-blue-300 bg-blue-50" : danger ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}><span className="block text-xs font-bold text-slate-500">{label}</span><strong className={`mt-1 block text-xl font-black ${danger ? "text-rose-700" : emphasized ? "text-blue-800" : "text-slate-950"}`}>{value}</strong></article>;
}

function SubMetric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><span className="block text-xs font-bold text-slate-500">{label}</span><strong className="mt-1 block text-lg font-black text-slate-950">{value}</strong></article>;
}

function Input({ value, onChange, disabled = false, required = false, placeholder = "", type = "text", mono = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean; placeholder?: string; type?: "text" | "url"; mono?: boolean }) {
  return <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`w-full rounded-lg border px-3 py-2 outline-none disabled:bg-slate-100 ${mono ? "font-mono text-[11px]" : "text-xs"} ${required ? "border-amber-400 bg-amber-50 focus:border-amber-600" : "border-slate-300 bg-white focus:border-blue-500"}`} />;
}

function NumberInput({ value, onChange, disabled = false, required = false }: { value: number; onChange: (value: number) => void; disabled?: boolean; required?: boolean }) {
  return <input type="number" min="0" step="0.0001" value={value || ""} disabled={disabled} onChange={(event) => onChange(decimal(event.target.value))} className={`w-28 rounded-lg border px-3 py-2 text-right text-xs font-bold outline-none disabled:bg-slate-100 ${required ? "border-amber-400 bg-amber-50 focus:border-amber-600" : "border-slate-300 bg-white focus:border-blue-500"}`} />;
}
