"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { parseFreightApplicationText } from "@/lib/freightApplicationParser";
import { createWarehouseLabelPdf } from "@/lib/warehouseLabelGenerator";
import type { FreightApplication, FreightApplicationItem } from "@/types/freightBarcodeRequest";

const EMPTY_APPLICATION: FreightApplication = { applicationNo: "", items: [] };

type MonthlyLine = {
  sourceEventId: string;
  draftId: string;
  occurredAt: string;
  cycleMonth: string;
  barcode: string;
  modelNo: string;
  modelName: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  supplierLink: string;
  orderNumber: string;
  orderedQuantity: number;
  unitPriceCny: number | null;
};

type MonthlyResponse = {
  ok: boolean;
  cycleMonth: string;
  lineCount: number;
  orderCount: number;
  totalQuantity: number;
  lines: MonthlyLine[];
  error?: string;
};

type MatchResult = {
  item: FreightApplicationItem;
  source: MonthlyLine | null;
  basis: "주문번호" | "주문번호+옵션" | "1688 링크" | "미매칭" | "후보중복";
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/[\[\](){}\-_/,:;|]+/g, "");
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, "");
}

function offerId(value: unknown) {
  const match = text(value).match(/offer\/(\d+)\.html/i);
  return match?.[1] ?? "";
}

function optionScore(item: FreightApplicationItem, line: MonthlyLine) {
  const haystack = compact(`${item.itemName} ${item.optionText}`);
  const values = [line.chinaOption, line.saleOption, line.modelName, line.productName]
    .map(compact)
    .filter((value) => value.length >= 2);
  let score = 0;
  for (const value of values) {
    if (haystack.includes(value)) score += 4;
    else if (value.includes(haystack) && haystack.length >= 3) score += 2;
  }
  if (item.quantity > 0 && item.quantity === line.orderedQuantity) score += 1;
  if (offerId(item.detailUrl) && offerId(item.detailUrl) === offerId(line.supplierLink)) score += 5;
  return score;
}

function enrich(item: FreightApplicationItem, line: MonthlyLine): FreightApplicationItem {
  return {
    ...item,
    locationCode: line.barcode,
    modelNo: line.modelNo,
    modelName: line.modelName || line.productName,
    optionName: line.saleOption || line.chinaOption,
    barcode: line.barcode,
    matchedModelNo: line.modelNo,
    matchedModelName: line.modelName || line.productName,
    matchedProductNameKo: line.productName || line.modelName,
    matchedBarcode: line.barcode,
    matchedOriginLabel: "MADE IN CHINA",
    matchedLabelText: line.barcode,
  };
}

function matchItem(item: FreightApplicationItem, lines: MonthlyLine[]): MatchResult {
  const orderNo = digits(item.orderNo);
  let candidates = orderNo
    ? lines.filter((line) => digits(line.orderNumber) === orderNo)
    : [];

  if (candidates.length === 1) {
    return { item: enrich(item, candidates[0]), source: candidates[0], basis: "주문번호" };
  }

  if (candidates.length > 1) {
    const scored = candidates
      .map((line) => ({ line, score: optionScore(item, line) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? -1)) {
      return {
        item: enrich(item, scored[0].line),
        source: scored[0].line,
        basis: "주문번호+옵션",
      };
    }
    return { item, source: null, basis: "후보중복" };
  }

  const itemOfferId = offerId(item.detailUrl);
  if (itemOfferId) {
    candidates = lines.filter((line) => offerId(line.supplierLink) === itemOfferId);
    if (candidates.length === 1) {
      return { item: enrich(item, candidates[0]), source: candidates[0], basis: "1688 링크" };
    }
    if (candidates.length > 1) {
      const scored = candidates
        .map((line) => ({ line, score: optionScore(item, line) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? -1)) {
        return {
          item: enrich(item, scored[0].line),
          source: scored[0].line,
          basis: "주문번호+옵션",
        };
      }
      return { item, source: null, basis: "후보중복" };
    }
  }

  return { item, source: null, basis: "미매칭" };
}

export default function MonthlyFreightBarcodeRequestPage() {
  const searchParams = useSearchParams();
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const [monthly, setMonthly] = useState<MonthlyResponse | null>(null);
  const [rawText, setRawText] = useState("");
  const [application, setApplication] = useState<FreightApplication>(EMPTY_APPLICATION);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [status, setStatus] = useState("온돌패스 신청서의 제품정보 영역을 그대로 붙여넣으세요.");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/freight-barcode-request/monthly-orders?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((value: MonthlyResponse) => {
        if (!cancelled) setMonthly(value);
      })
      .catch((error) => {
        if (!cancelled) {
          setMonthly({
            ok: false,
            cycleMonth: month,
            lineCount: 0,
            orderCount: 0,
            totalQuantity: 0,
            lines: [],
            error: error instanceof Error ? error.message : "LOAD_FAILED",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  useEffect(() => {
    return () => {
      if (pdfRef.current) URL.revokeObjectURL(pdfRef.current);
    };
  }, []);

  const matchedCount = matches.filter((row) => row.source).length;
  const ambiguousCount = matches.filter((row) => row.basis === "후보중복").length;
  const sourceBarcodes = useMemo(
    () => [...new Set((monthly?.lines ?? []).map((row) => row.barcode))],
    [monthly],
  );

  function analyze() {
    if (!monthly?.ok) {
      setStatus("해당 월 주문정보를 먼저 불러와야 합니다.");
      return;
    }
    try {
      const parsed = parseFreightApplicationText(rawText);
      const nextMatches = parsed.items.map((item) => matchItem(item, monthly.lines));
      setApplication({ ...parsed, items: nextMatches.map((row) => row.item) });
      setMatches(nextMatches);
      const matched = nextMatches.filter((row) => row.source).length;
      const ambiguous = nextMatches.filter((row) => row.basis === "후보중복").length;
      setStatus(
        `${parsed.items.length}개 품목 분석 · ${matched}개 자동매칭${
          ambiguous ? ` · ${ambiguous}개 후보중복` : ""
        }`,
      );
    } catch (error) {
      setApplication(EMPTY_APPLICATION);
      setMatches([]);
      setStatus(error instanceof Error ? error.message : "신청서 분석에 실패했습니다.");
    }
  }

  function generateMatchedBarcodePdf() {
    const codes = matches
      .filter((row) => row.source)
      .map((row) => row.source!.barcode);
    if (!codes.length) {
      setStatus("자동매칭된 B코드가 없습니다.");
      return;
    }
    const bytes = createWarehouseLabelPdf(codes);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const blob = new Blob([buffer], { type: "application/pdf" });
    if (pdfRef.current) URL.revokeObjectURL(pdfRef.current);
    const url = URL.createObjectURL(blob);
    pdfRef.current = url;
    setPdfUrl(url);
    setStatus(`${codes.length}개 B코드 라벨 PDF를 만들었습니다.`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · MONTHLY FORWARDER BARCODE"
        title={`${month} 배송대행지 바코드 출력`}
        description="해당 월 Ops Center 실주문 정보를 먼저 불러온 뒤 온돌패스 신청서를 붙여넣으면 주문번호를 1순위로, 1688 상품번호와 옵션을 보조키로 사용해 B코드·모델번호·옵션을 자동 연결합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/china-order-manager?month=${encodeURIComponent(month)}`}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              월 발주관리로 돌아가기
            </Link>
            <Link
              href="/freight-barcode-request"
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              기존 전체 바코드 출력기
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-4">
        <Summary label="월 주문품목" value={monthly ? `${monthly.lineCount}개` : "불러오는 중"} />
        <Summary label="1688 주문번호" value={monthly ? `${monthly.orderCount}건` : "-"} />
        <Summary label="총 주문수량" value={monthly ? `${monthly.totalQuantity.toLocaleString("ko-KR")}개` : "-"} />
        <Summary label="전달 B코드" value={`${sourceBarcodes.length}개`} />
      </section>

      {monthly && !monthly.ok ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          월 주문정보를 불러오지 못했습니다: {monthly.error || "UNKNOWN"}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-black tracking-[0.12em] text-blue-700">ONDOLPASS PASTE</span>
              <h2 className="mt-1 text-xl font-black text-slate-950">온돌패스 신청서 복붙</h2>
              <p className="mt-1 text-sm text-slate-500">신청번호와 제품정보 전체를 그대로 붙여넣으면 됩니다.</p>
            </div>
            <button
              type="button"
              onClick={analyze}
              className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800"
            >
              분석 + B코드 자동채움
            </button>
          </div>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={18}
            className="mt-4 w-full rounded-xl border border-slate-300 p-4 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="신청번호: ...\n제품정보:(1)\n...\n오픈마켓 주문번호: ..."
          />
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{status}</div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-xs font-black tracking-[0.12em] text-emerald-700">AUTO MATCH</span>
          <h2 className="mt-1 text-xl font-black text-slate-950">자동연동 결과</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <Row label="신청서 품목" value={`${application.items.length}개`} />
            <Row label="자동매칭" value={`${matchedCount}개`} />
            <Row label="후보중복" value={`${ambiguousCount}개`} />
            <Row label="미매칭" value={`${Math.max(0, application.items.length - matchedCount - ambiguousCount)}개`} />
          </dl>
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={generateMatchedBarcodePdf}
              disabled={!matchedCount}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              자동매칭 B코드 PDF 생성
            </button>
            <a
              href={pdfUrl ?? undefined}
              download={`ondolpass-bcodes-${month}.pdf`}
              aria-disabled={!pdfUrl}
              className={`block w-full rounded-xl px-4 py-3 text-center text-sm font-black ${
                pdfUrl
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "pointer-events-none bg-slate-200 text-slate-400"
              }`}
            >
              PDF 다운로드
            </a>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            자동매칭 기준: 주문번호 정확일치 → 같은 주문번호 내 옵션/1688 링크 비교 → 주문번호가 없을 때 1688 offer 번호 단독일치. 애매한 경우 자동으로 확정하지 않습니다.
          </p>
        </aside>
      </section>

      {matches.length ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-black text-slate-950">신청서 ↔ 월 주문 자동 매칭표</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black text-slate-600">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">온돌패스 품목/옵션</th>
                  <th className="px-4 py-3">주문번호</th>
                  <th className="px-4 py-3">매칭기준</th>
                  <th className="px-4 py-3">B코드</th>
                  <th className="px-4 py-3">모델</th>
                  <th className="px-4 py-3">판매옵션 / 중국옵션</th>
                  <th className="px-4 py-3">주문수량</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matches.map((row, index) => (
                  <tr key={row.item.id} className={row.source ? "bg-white" : "bg-amber-50/40"}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{row.item.itemName || "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.item.optionText || "-"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{row.item.orderNo || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-black ${
                        row.source
                          ? "bg-emerald-100 text-emerald-800"
                          : row.basis === "후보중복"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                      }`}>
                        {row.basis}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-black text-blue-700">{row.source?.barcode || "확인 필요"}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{row.source?.modelNo || "-"}</div>
                      <div className="text-xs text-slate-500">{row.source?.modelName || row.source?.productName || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{row.source?.saleOption || "-"}</div>
                      <div className="mt-1 text-slate-500">{row.source?.chinaOption || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold">{row.source?.orderedQuantity?.toLocaleString("ko-KR") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-black text-slate-950">{value}</dd>
    </div>
  );
}
