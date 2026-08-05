"use client";

import Link from "next/link";
import { strFromU8, unzip } from "fflate";
import { useState } from "react";
import {
  VERIFIED_PRODUCT_DECISION_BACKUP,
  buildProductDecisionSnapshot,
  sha256Hex,
  stableStringify,
  validateProductDecisionBackupMetadata,
  type PortableD1Completed,
  type PortableD1Manifest,
  type ProductDecisionRawTables,
} from "@/lib/productDecisionSnapshot";
import {
  replayAndCompareProductDecisionD1,
  type ProductDecisionShadowReport,
} from "@/lib/productDecisionEngine/shadowComparison";
import { validateVerifiedProductDecisionShadow } from "@/lib/productDecisionEngine/verifiedShadow";
import type { PortableD1ProductDecisionTables } from "@/lib/productDecisionEngine/d1SourceAdapter";

const REQUIRED_TABLES = [
  "app_settings",
  "canonical_products",
  "claims",
  "decision_evidence",
  "decision_items",
  "decision_runs",
  "inventory_positions",
  "order_lines",
  "product_planning_profiles",
  "purchase_commitments",
] as const;

export function ProductDecisionSnapshotImporter() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(
    "검증 완료된 commerce-os-d1-2026-08-05T09-58-00-019Z.zip 파일을 선택하세요.",
  );
  const [done, setDone] = useState(false);
  const [shadowReport, setShadowReport] =
    useState<ProductDecisionShadowReport | null>(null);

  async function importBackup(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setDone(false);
    setShadowReport(null);
    setProgress(5);
    setMessage("ZIP 파일 지문을 확인하고 있습니다.");

    try {
      const buffer = await file.arrayBuffer();
      const zipSha256 = await sha256Hex(buffer);
      setProgress(15);
      const files = await unzipArchive(new Uint8Array(buffer));
      setMessage("D1 백업 완료표식과 18개 테이블 행 수를 확인하고 있습니다.");

      const manifest = parseJsonFile<PortableD1Manifest>(files, "/manifest.json");
      const completed = parseJsonFile<PortableD1Completed>(files, "/completed.json");
      validateProductDecisionBackupMetadata(manifest, completed, zipSha256);
      setProgress(30);

      const parsedTables = Object.fromEntries(
        REQUIRED_TABLES.map((table) => [table, parseTable(files, table)]),
      ) as PortableD1ProductDecisionTables;
      setMessage("기존 최신 발주 계산 316개를 Ops Center 스냅샷으로 복원하고 있습니다.");
      const snapshot = buildProductDecisionSnapshot(
        parsedTables as unknown as ProductDecisionRawTables,
      );
      const dashboardSha256 = await sha256Hex(stableStringify(snapshot));
      if (dashboardSha256 !== VERIFIED_PRODUCT_DECISION_BACKUP.dashboardSha256) {
        throw new Error(
          "재구성한 발주 계산 결과가 검증된 백업 결과와 일치하지 않습니다.",
        );
      }
      setProgress(50);
      setMessage(
        "원시 주문·클레임·상품·재고 원장으로 Ops Center 자체 엔진을 그림자 재계산하고 있습니다.",
      );

      const shadow = replayAndCompareProductDecisionD1(parsedTables);
      validateVerifiedProductDecisionShadow(shadow.report);
      setShadowReport(shadow.report);
      setProgress(75);
      setMessage(
        "검증된 스냅샷과 그림자 재계산 보고서를 Ops Center 운영 원장에 보존하고 있습니다.",
      );

      const response = await fetch(
        "/api/product-decision-agent/migration/import",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            zipSha256,
            dashboardSha256,
            manifest,
            completed,
            snapshot,
            shadowReport: shadow.report,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        productCount?: number;
        shadowExactCount?: number;
        shadowMismatchCount?: number;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || "Ops Center 스냅샷 저장에 실패했습니다.");
      }

      setProgress(100);
      setDone(true);
      setMessage(
        `검증 완료 · 내부 스냅샷 ${Number(body.productCount ?? 0).toLocaleString("ko-KR")}개 · 그림자 최종 일치 ${Number(body.shadowExactCount ?? 0).toLocaleString("ko-KR")}개 · 시점차이 ${Number(body.shadowMismatchCount ?? 0).toLocaleString("ko-KR")}개 · 원인불명 0개`,
      );
    } catch (error) {
      setProgress(0);
      setMessage(
        error instanceof Error
          ? error.message
          : "발주 추천 백업 복원에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <strong className="block text-base">검증 백업만 허용</strong>
        <p className="mt-2 leading-6">
          ZIP 지문, 원본 주소, 백업 시각, 18개 테이블의 67,260행과 기존 발주안
          316개를 검증한 뒤 Ops Center 자체 엔진으로 한 번 더 계산합니다.
        </p>
        <p className="mt-2 text-xs text-emerald-700">
          실제 주문·결제·입고·재고·샵플링 변경과 기존 D1 수정은 실행하지 않습니다.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-bold text-slate-800" htmlFor="d1-backup">
          발주 추천 D1 백업 ZIP
        </label>
        <input
          id="d1-backup"
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(event) => void importBackup(event.target.files?.[0])}
          className="mt-3 block w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:font-bold file:text-white disabled:opacity-60"
        />

        <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold">{message}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-right text-xs font-bold text-slate-500">
            {progress}%
          </p>
        </div>

        {shadowReport ? (
          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <ShadowMetric label="전체 상품" value={shadowReport.productCount} />
            <ShadowMetric label="최종 일치" value={shadowReport.exactFinalCount} />
            <ShadowMetric label="원장 시점차이" value={shadowReport.sourceInputDriftCount} />
            <ShadowMetric label="최종 차이" value={shadowReport.finalMismatchCount} />
            <ShadowMetric
              label="원인불명"
              value={shadowReport.unexplainedMismatchCount}
              danger={shadowReport.unexplainedMismatchCount > 0}
            />
          </section>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/product-decision-agent"
            className={`rounded-xl px-4 py-2.5 text-sm font-bold ${
              done
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {done ? "검증된 발주 추천 확인" : "발주 추천으로 돌아가기"}
          </Link>
        </div>
      </section>
    </div>
  );
}

function ShadowMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${
        danger
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-slate-200 bg-white text-slate-900"
      }`}
    >
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <strong className="mt-1 block text-2xl font-black">
        {value.toLocaleString("ko-KR")}
      </strong>
    </article>
  );
}

function unzipArchive(bytes: Uint8Array) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

function parseJsonFile<T>(files: Record<string, Uint8Array>, suffix: string): T {
  const entry = Object.entries(files).find(([name]) => name.endsWith(suffix));
  if (!entry) throw new Error(`${suffix.slice(1)} 파일이 ZIP에 없습니다.`);
  return JSON.parse(strFromU8(entry[1])) as T;
}

function parseTable(files: Record<string, Uint8Array>, table: string) {
  const pattern = new RegExp(`/data/\\d+-${escapeRegExp(table)}\\.ndjson$`);
  const entry = Object.entries(files).find(([name]) => pattern.test(name));
  if (!entry) throw new Error(`${table} 백업 데이터가 ZIP에 없습니다.`);
  const text = strFromU8(entry[1]);
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`${table} ${index + 1}번째 행의 JSON 형식이 올바르지 않습니다.`);
      }
    });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
