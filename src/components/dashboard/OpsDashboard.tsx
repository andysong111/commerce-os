"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CommerceModule } from "@/lib/moduleRegistry";
import {
  DEFAULT_FAVORITE_MODULE_IDS,
  extractGoodsKey,
  extractModelNumber,
  getWorkspaceGroup,
  getWorkspaceGroupById,
  moduleRouteWithContext,
  OPS_WORKSPACE_GROUPS,
  rankWorkspaceModules,
  resolveOpsCommand,
} from "@/lib/opsWorkspace";

const FAVORITES_KEY = "opsCenter.dashboard.favorites.v1";
const RECENT_KEY = "opsCenter.dashboard.recent.v1";
const RETRY_KEY = "opsCenter.dashboard.retry.v1";
const HISTORY_KEY = "opsCenter.engineRunnerHistory.v1";
const TRACKER_KEY = "commerce-os-product-launch-tracker:v2";
const ENABLED = new Set(["available", "runner_scaffold", "check_mode"]);

type RecentItem = { moduleId: string; openedAt: string };
type HistoryItem = {
  id?: string;
  kind?: "keyword_engine" | "detail_page_engine";
  title?: string;
  summary?: string;
  createdAt?: string;
  status?: string;
  input?: Record<string, string | undefined>;
};
type Signals = {
  failed: HistoryItem[];
  pendingReview: number;
  launchOpen: number;
  launchBlocked: number;
};

export function OpsDashboard({
  modules,
  selectedGroupId,
}: {
  modules: readonly CommerceModule[];
  selectedGroupId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([
    ...DEFAULT_FAVORITE_MODULE_IDS,
  ]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [signals, setSignals] = useState<Signals>({
    failed: [],
    pendingReview: 0,
    launchOpen: 0,
    launchBlocked: 0,
  });
  const [copied, setCopied] = useState<string | null>(null);

  const moduleById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules],
  );
  const activeModules = useMemo(
    () => modules.filter((module) => module.route && ENABLED.has(module.status)),
    [modules],
  );
  const selectedGroup = getWorkspaceGroupById(selectedGroupId);
  const searchResults = useMemo(
    () =>
      query.trim()
        ? rankWorkspaceModules(activeModules, query).slice(0, 12)
        : [],
    [activeModules, query],
  );
  const command = useMemo(() => resolveOpsCommand(query), [query]);
  const contextCode = extractModelNumber(query) ?? extractGoodsKey(query);

  useEffect(() => {
    setFavorites(
      readStringArray(FAVORITES_KEY, [...DEFAULT_FAVORITE_MODULE_IDS]),
    );
    setRecent(readJsonArray<RecentItem>(RECENT_KEY).slice(0, 12));
    setSignals(readSignals());
    void fetch("/api/product-launch-tracker/state", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.ok !== true || !body.state) return;
        setSignals((current) => ({
          ...current,
          ...trackerSignals(body.state),
        }));
      })
      .catch(() => undefined);
  }, []);

  function rememberOpen(moduleId: string) {
    const next = [
      { moduleId, openedAt: new Date().toISOString() },
      ...recent.filter((item) => item.moduleId !== moduleId),
    ].slice(0, 12);
    setRecent(next);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }

  function toggleFavorite(moduleId: string) {
    setFavorites((current) => {
      const next = current.includes(moduleId)
        ? current.filter((item) => item !== moduleId)
        : [moduleId, ...current];
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function openSearchResult(module: CommerceModule) {
    const route = moduleRouteWithContext(module, query);
    if (!route) return;
    if (contextCode && navigator.clipboard) {
      await navigator.clipboard.writeText(contextCode).catch(() => undefined);
      setCopied(contextCode);
      window.setTimeout(() => setCopied(null), 1800);
    }
    rememberOpen(module.id);
    window.location.assign(route);
  }

  function retry(item: HistoryItem) {
    const route =
      item.kind === "detail_page_engine"
        ? "/detail-page-engine-runner"
        : "/keyword-engine-runner";
    window.sessionStorage.setItem(
      RETRY_KEY,
      JSON.stringify({
        kind: item.kind,
        input: item.input ?? {},
        sourceHistoryId: item.id,
        preparedAt: new Date().toISOString(),
      }),
    );
    window.location.assign(route);
  }

  const favoriteModules = favorites
    .map((id) => moduleById.get(id))
    .filter((module): module is CommerceModule => Boolean(module?.route));
  const recentModules = recent
    .map((item) => ({ ...item, module: moduleById.get(item.moduleId) }))
    .filter(
      (item): item is RecentItem & { module: CommerceModule } =>
        Boolean(item.module?.route),
    );

  return (
    <div className="space-y-6">
      <SearchBox
        query={query}
        onChange={setQuery}
        resultCount={searchResults.length}
        contextCode={contextCode}
        copied={copied}
      />

      {query.trim() ? (
        <section className="space-y-4" aria-labelledby="search-results-heading">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
              추천 실행
            </p>
            <h2
              id="search-results-heading"
              className="mt-1 text-lg font-bold text-blue-950"
            >
              {command?.label ?? `“${query.trim()}” 검색 결과`}
            </h2>
            <p className="mt-1 text-sm text-blue-900">
              {command?.reason ??
                "기능 설명, 입력값과 업무 영역을 함께 검색했습니다."}
              {contextCode
                ? ` ${contextCode}은 기능을 열 때 자동 복사합니다.`
                : ""}
            </p>
          </div>
          <ModuleList
            modules={searchResults}
            favorites={favorites}
            contextCode={contextCode}
            onOpen={openSearchResult}
            onToggleFavorite={toggleFavorite}
          />
          {searchResults.length === 0 ? (
            <EmptySearch onClear={() => setQuery("")} />
          ) : null}
        </section>
      ) : selectedGroup ? (
        <GroupView
          groupId={selectedGroup.id}
          modules={selectedGroup.moduleIds
            .map((id) => moduleById.get(id))
            .filter((module): module is CommerceModule => Boolean(module))}
          favorites={favorites}
          onOpen={rememberOpen}
          onToggleFavorite={toggleFavorite}
        />
      ) : (
        <>
          <SignalStrip modules={modules} recent={recent} signals={signals} />
          <Workflow modules={modules} />
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <Panel
              title="자주 사용하는 기능"
              description="별표로 직접 고정할 수 있습니다."
            >
              <ModuleList
                modules={favoriteModules}
                favorites={favorites}
                onOpen={(module) => rememberOpen(module.id)}
                onToggleFavorite={toggleFavorite}
              />
            </Panel>
            <Panel
              title="최근 사용"
              description="이 브라우저에서 연 기능을 자동 기록합니다."
            >
              {recentModules.length ? (
                <div className="divide-y divide-slate-100">
                  {recentModules.slice(0, 5).map(({ module, openedAt }) => (
                    <Link
                      key={module.id}
                      href={module.route!}
                      onClick={() => rememberOpen(module.id)}
                      className="flex items-center justify-between gap-3 py-3 text-sm hover:text-blue-700"
                    >
                      <span className="font-semibold text-slate-800">
                        {module.title}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {relativeTime(openedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-slate-400">
                  기능을 열면 최근 사용 목록이 생깁니다.
                </p>
              )}
            </Panel>
          </div>
          {signals.failed.length ? (
            <FailurePanel items={signals.failed} onRetry={retry} />
          ) : null}
          <GroupDirectory modules={modules} />
        </>
      )}
    </div>
  );
}

function SearchBox({
  query,
  onChange,
  resultCount,
  contextCode,
  copied,
}: {
  query: string;
  onChange: (value: string) => void;
  resultCount: number;
  contextCode: string | null;
  copied: string | null;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            기능·상품·작업 통합 검색
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            무엇을 처리할지 그대로 입력하세요
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            예: AAA413 가격 올리기, 위치코드 넣기, 신규 상품 등록, 실패
            작업 확인
          </p>
        </div>
        <p className="text-xs font-semibold text-slate-500">
          {query.trim()
            ? `${resultCount}개 추천${
                contextCode ? ` · ${contextCode} 인식` : ""
              }`
            : "자연어 명령과 기능명 모두 지원"}
        </p>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
        <span aria-hidden="true" className="text-lg text-slate-400">
          ⌕
        </span>
        <input
          value={query}
          onChange={(event) => onChange(event.target.value)}
          placeholder="기능, 모델번호, goods_key 또는 할 일을 입력하세요"
          aria-label="OPS Center 통합 검색"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200"
          >
            지우기
          </button>
        ) : null}
      </div>
      {copied ? (
        <p className="mt-2 text-xs font-semibold text-emerald-700">
          {copied}을 복사한 뒤 기능을 열었습니다.
        </p>
      ) : null}
    </section>
  );
}

function SignalStrip({
  modules,
  recent,
  signals,
}: {
  modules: readonly CommerceModule[];
  recent: RecentItem[];
  signals: Signals;
}) {
  const cards = [
    {
      label: "출시 미완료",
      value: signals.launchOpen,
      detail: signals.launchBlocked
        ? `보류 ${signals.launchBlocked}건 포함`
        : "출시 진행관리 기준",
      href: "/product-launch-tracker",
      tone: signals.launchBlocked ? "amber" : "blue",
    },
    {
      label: "실패 작업",
      value: signals.failed.length,
      detail: signals.failed.length
        ? "아래에서 입력 복원 가능"
        : "현재 확인된 실패 없음",
      href: "#failed-jobs",
      tone: signals.failed.length ? "red" : "emerald",
    },
    {
      label: "검토 대기",
      value: signals.pendingReview,
      detail: "외부 엔진 요청 이력 기준",
      href: "/engine-runner-history",
      tone: signals.pendingReview ? "indigo" : "emerald",
    },
    {
      label: "오늘 사용",
      value: recent.filter((item) => isToday(item.openedAt)).length,
      detail: `${
        modules.filter(
          (module) => module.route && ENABLED.has(module.status),
        ).length
      }개 기능 사용 가능`,
      href: "#workspaces",
      tone: "slate",
    },
  ];

  return (
    <section aria-labelledby="action-summary-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="action-summary-heading"
          className="text-sm font-bold text-slate-900"
        >
          지금 확인할 항목
        </h2>
        <span className="text-xs text-slate-400">
          문제가 없으면 경고를 늘리지 않습니다.
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-600">
                  {card.label}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {card.value}
                </p>
              </div>
              <Dot tone={card.tone} />
            </div>
            <p className="mt-2 text-xs text-slate-400">{card.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Workflow({ modules }: { modules: readonly CommerceModule[] }) {
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-slate-900">핵심 업무 흐름</h2>
        <p className="mt-1 text-xs text-slate-500">
          기능 이름 대신 실제 업무 순서로 이동합니다.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {OPS_WORKSPACE_GROUPS.map((group, index) => {
          const available = group.moduleIds.filter((id) => {
            const module = moduleById.get(id);
            return module?.route && ENABLED.has(module.status);
          }).length;
          return (
            <Link
              key={group.id}
              href={`/?group=${group.id}`}
              className="group rounded-xl border border-slate-200 bg-slate-50 p-4 hover:border-blue-400 hover:bg-blue-50"
            >
              <p className="text-[11px] font-bold text-slate-400">
                {index + 1}단계
              </p>
              <p className="mt-1 font-bold text-slate-900 group-hover:text-blue-800">
                {group.label}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                사용 가능 {available}개
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function GroupDirectory({ modules }: { modules: readonly CommerceModule[] }) {
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  return (
    <section id="workspaces" aria-labelledby="workspaces-heading">
      <div className="mb-3">
        <h2 id="workspaces-heading" className="text-sm font-bold text-slate-900">
          업무 영역
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          전체 카드를 나열하지 않고 같은 기능끼리 묶었습니다.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {OPS_WORKSPACE_GROUPS.map((group) => {
          const groupModules = group.moduleIds
            .map((id) => moduleById.get(id))
            .filter((module): module is CommerceModule => Boolean(module));
          return (
            <Link
              key={group.id}
              href={`/?group=${group.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">
                  {group.iconLabel}
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {groupModules.length}개
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-950">
                {group.label}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {group.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {groupModules.slice(0, 3).map((module) => (
                  <span
                    key={module.id}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                  >
                    {module.navigationLabel ?? module.title}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-sm font-bold text-blue-600">
                관련 기능 보기 →
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function GroupView({
  groupId,
  modules,
  favorites,
  onOpen,
  onToggleFavorite,
}: {
  groupId: string;
  modules: CommerceModule[];
  favorites: string[];
  onOpen: (moduleId: string) => void;
  onToggleFavorite: (moduleId: string) => void;
}) {
  const group = getWorkspaceGroupById(groupId)!;
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
            업무 영역
          </p>
          <h2 className="mt-1 text-2xl font-black">{group.label}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            {group.description}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-white/20 px-3.5 py-2 text-sm font-semibold hover:bg-white/10"
        >
          전체 대시보드
        </Link>
      </div>
      <ModuleList
        modules={modules}
        favorites={favorites}
        onOpen={(module) => onOpen(module.id)}
        onToggleFavorite={onToggleFavorite}
      />
    </section>
  );
}

function ModuleList({
  modules,
  favorites,
  contextCode,
  onOpen,
  onToggleFavorite,
}: {
  modules: CommerceModule[];
  favorites: string[];
  contextCode?: string | null;
  onOpen: (module: CommerceModule) => void;
  onToggleFavorite: (moduleId: string) => void;
}) {
  if (!modules.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {modules.map((module, index) => (
        <ModuleRow
          key={module.id}
          module={module}
          favorite={favorites.includes(module.id)}
          highlighted={index === 0 && Boolean(contextCode)}
          contextCode={contextCode}
          onOpen={() => onOpen(module)}
          onToggleFavorite={() => onToggleFavorite(module.id)}
        />
      ))}
    </div>
  );
}

function ModuleRow({
  module,
  favorite,
  highlighted,
  contextCode,
  onOpen,
  onToggleFavorite,
}: {
  module: CommerceModule;
  favorite: boolean;
  highlighted?: boolean;
  contextCode?: string | null;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const group = getWorkspaceGroup(module.id);
  const enabled = Boolean(module.route && ENABLED.has(module.status));
  const warning =
    module.status === "preparing"
      ? "준비 중"
      : module.status === "check_mode"
        ? "점검 모드"
        : module.safetyBadge ?? null;

  return (
    <article
      className={`flex flex-col gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center ${
        highlighted ? "bg-blue-50/70" : "bg-white"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-black text-slate-700">
          {group?.iconLabel ?? "기"}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-slate-950">{module.title}</h3>
            {highlighted ? (
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                가장 적합
              </span>
            ) : null}
            {warning ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {warning}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            {module.description}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-slate-400">
            {group?.label ?? module.category}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={
            favorite
              ? `${module.title} 즐겨찾기 해제`
              : `${module.title} 즐겨찾기 추가`
          }
          className={`grid size-9 place-items-center rounded-lg border text-base ${
            favorite
              ? "border-amber-200 bg-amber-50 text-amber-600"
              : "border-slate-200 text-slate-300 hover:text-amber-500"
          }`}
        >
          {favorite ? "★" : "☆"}
        </button>
        {enabled ? (
          contextCode ? (
            <button
              type="button"
              onClick={onOpen}
              className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
            >
              {contextCode} 복사 후 열기
            </button>
          ) : (
            <Link
              href={module.route!}
              onClick={onOpen}
              className="rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
            >
              열기
            </Link>
          )
        ) : (
          <span className="rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-400">
            준비 중
          </span>
        )}
      </div>
    </article>
  );
}

function FailurePanel({
  items,
  onRetry,
}: {
  items: HistoryItem[];
  onRetry: (item: HistoryItem) => void;
}) {
  return (
    <section
      id="failed-jobs"
      className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3">
        <h2 className="text-sm font-bold text-red-900">실패 작업</h2>
        <p className="mt-1 text-xs text-red-700">
          기존 입력을 복원하되 자동 실행하지는 않습니다.
        </p>
      </div>
      <div className="divide-y divide-red-100">
        {items.slice(0, 5).map((item, index) => (
          <div
            key={item.id ?? `${item.createdAt}-${index}`}
            className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-bold text-slate-900">
                {item.title ?? "외부 엔진 실행 실패"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {item.summary ??
                  "입력값을 복원해 원인을 확인하고 다시 실행하세요."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRetry(item)}
              className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700"
            >
              입력 복원 후 재실행
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptySearch({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="font-bold text-slate-800">맞는 기능을 찾지 못했습니다.</p>
      <p className="mt-1 text-sm text-slate-500">
        가격, 발주, 입고, 위치코드, 상품등록처럼 할 일을 짧게 입력하세요.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white"
      >
        검색 초기화
      </button>
    </div>
  );
}

function Dot({ tone }: { tone: string }) {
  const tones: Record<string, string> = {
    red: "bg-red-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    slate: "bg-slate-300",
  };
  return (
    <span
      className={`mt-1 size-2.5 rounded-full ${tones[tone] ?? tones.slate}`}
      aria-hidden="true"
    />
  );
}

function readSignals(): Signals {
  const history = readJsonArray<HistoryItem>(HISTORY_KEY);
  const tracker = readJsonObject(TRACKER_KEY);
  return {
    failed: history.filter((item) => item.status === "failed"),
    pendingReview: history.filter((item) => item.status === "requested").length,
    ...trackerSignals(tracker),
  };
}

function trackerSignals(value: unknown) {
  if (!value || typeof value !== "object") {
    return { launchOpen: 0, launchBlocked: 0 };
  }
  const items = Array.isArray((value as { items?: unknown[] }).items)
    ? (value as { items: unknown[] }).items
    : [];
  let launchOpen = 0;
  let launchBlocked = 0;

  for (const raw of items) {
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { archivedAt?: unknown }).archivedAt
    ) {
      continue;
    }
    const stages = Object.values(
      (raw as { stages?: Record<string, unknown> }).stages ?? {},
    );
    const statuses = stages.map((stage) =>
      typeof stage === "string"
        ? stage
        : stage && typeof stage === "object"
          ? String((stage as { status?: unknown }).status ?? "")
          : "",
    );
    if (
      !(statuses.length && statuses.every((status) => status === "완료"))
    ) {
      launchOpen += 1;
    }
    if (statuses.some((status) => status === "보류")) launchBlocked += 1;
  }
  return { launchOpen, launchBlocked };
}

function readStringArray(key: string, fallback: string[]) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    return Array.isArray(value) &&
      value.every((item) => typeof item === "string")
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}

function readJsonArray<T>(key: string): T[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readJsonObject(key: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function isToday(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "최근 사용";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}
