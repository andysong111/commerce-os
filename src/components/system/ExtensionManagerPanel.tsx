"use client";

import { useEffect, useMemo, useState } from "react";

import { KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION } from "@/lib/keywordEngineElonLabBrowserImport";

type ExtensionRecord = {
  id: string;
  name: string;
  purpose: string;
  latestVersion: string;
  management: "ops" | "external";
  downloadUrl?: string;
  detector?: "keywordCollector";
  note: string;
};

const EXTENSIONS: readonly ExtensionRecord[] = [
  {
    id: "keyword-lab-collector",
    name: "Commerce OS Keyword Lab Collector",
    purpose: "1688 상품 수집, 링크 오류 판정, SEO 대량등록 클라우드 원본 수집",
    latestVersion: KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION,
    management: "ops",
    downloadUrl: "/api/keyword-engine-elon-lab/collector-zip",
    detector: "keywordCollector",
    note: "Ops Center가 직접 관리하는 확장프로그램입니다. 설치버전을 자동 감지합니다.",
  },
  {
    id: "ai-saurus-importer",
    name: "AI-Saurus Importer",
    purpose: "1688 상품 이미지·상품 근거를 AI-Saurus 상세페이지 SaaS로 전달",
    latestVersion: "0.4.14",
    management: "external",
    note: "현재 관리 기준 버전입니다. 소스·ZIP 원장을 Ops Center와 연결하면 자동 업데이트 관리로 전환할 수 있습니다.",
  },
  {
    id: "commerce-os-1688-auto",
    name: "Commerce OS · 1688 자동수집",
    purpose: "1688 중국상품 발굴·공급후보 수집 자동화",
    latestVersion: "0.1.25",
    management: "external",
    note: "현재 관리 기준 버전입니다. 별도 확장프로그램 원장을 연결하기 전까지 설치버전은 Chrome 확장관리 화면에서 확인합니다.",
  },
] as const;

function parseVersion(value: string) {
  return value
    .split(".")
    .slice(0, 4)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersion(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

export default function ExtensionManagerPanel() {
  const [keywordCollectorVersion, setKeywordCollectorVersion] = useState("");

  useEffect(() => {
    const detect = () => {
      setKeywordCollectorVersion(
        document.documentElement.dataset.commerceOsKeywordLabCollectorVersion || "",
      );
    };
    detect();
    document.addEventListener("commerce-os-keyword-lab-collector-ready", detect);
    const retry = window.setTimeout(detect, 900);
    return () => {
      document.removeEventListener("commerce-os-keyword-lab-collector-ready", detect);
      window.clearTimeout(retry);
    };
  }, []);

  const managedStatus = useMemo(() => {
    if (!keywordCollectorVersion) return "not-detected" as const;
    return compareVersion(keywordCollectorVersion, KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION) >= 0
      ? ("current" as const)
      : ("update" as const);
  }, [keywordCollectorVersion]);

  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
            COMMERCE OS · EXTENSION CONTROL
          </div>
          <h2 className="mt-1 text-xl font-black text-slate-950">확장프로그램 관리</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Commerce OS에서 사용하는 Chrome 확장프로그램의 관리 기준 버전과 설치 상태를 한곳에서 확인합니다.
            Ops Center가 직접 관리하는 확장프로그램은 여기서 최신 ZIP을 바로 받을 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">관리 대상 {EXTENSIONS.length}개</span>
          <span className="rounded-full bg-indigo-100 px-3 py-1.5 text-indigo-800">Ops 직접관리 1개</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        {EXTENSIONS.map((extension) => {
          const installed = extension.detector === "keywordCollector" ? keywordCollectorVersion : "";
          const status = extension.detector === "keywordCollector" ? managedStatus : "external";
          const badge =
            status === "current"
              ? "최신"
              : status === "update"
                ? "업데이트 필요"
                : status === "not-detected"
                  ? "미감지"
                  : "수동 관리";
          const badgeClass =
            status === "current"
              ? "bg-emerald-100 text-emerald-800"
              : status === "update"
                ? "bg-rose-100 text-rose-800"
                : "bg-amber-100 text-amber-900";

          return (
            <article key={extension.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-slate-950">{extension.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{extension.purpose}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${badgeClass}`}>{badge}</span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="font-bold text-slate-500">관리 기준 버전</dt>
                  <dd className="mt-1 text-base font-black text-slate-950">{extension.latestVersion}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="font-bold text-slate-500">이 브라우저</dt>
                  <dd className="mt-1 text-base font-black text-slate-950">{installed || (extension.management === "external" ? "수동 확인" : "미감지")}</dd>
                </div>
              </dl>

              <p className="mt-3 text-xs leading-5 text-slate-600">{extension.note}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {extension.downloadUrl ? (
                  <a
                    href={extension.downloadUrl}
                    className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white"
                  >
                    최신 ZIP 다운로드
                  </a>
                ) : (
                  <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
                    ZIP 원장 연결 필요
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <h3 className="font-black text-slate-950">수동 ZIP 설치</h3>
          <p className="mt-2 leading-6">
            ZIP 압축 해제 → <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">chrome://extensions</code> → 개발자 모드 → 기존 버전 삭제 →
            ‘압축해제된 확장 프로그램을 로드’ → 새 폴더 선택 → Ops Center Ctrl+F5 순서입니다.
          </p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
          <h3 className="font-black">Chrome Web Store 전환 권장</h3>
          <p className="mt-2 leading-6">
            장기적으로는 ZIP 수동 설치보다 Web Store의 비공개/미등록 배포를 사용하면 Chrome이 업데이트를 자동 배포할 수 있어 운영이 단순해집니다.
            현재 Commerce OS 확장프로그램은 아직 Web Store 자동배포 원장이 연결되지 않은 상태로 표시합니다.
          </p>
        </div>
      </div>
    </section>
  );
}
