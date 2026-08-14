"use client";

import { useEffect, useMemo, useState } from "react";
import { computeShoplingCategoryAccuracyMetrics } from "@/lib/shoplingCategoryLearning";
import { applyShoplingCategoryReviewDecisions } from "@/lib/shoplingCategoryReview";

const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const CATALOG_ENDPOINT = "/api/shopling-categories/catalog";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";

type RecordLike = Record<string, unknown>;
type TrackerState = RecordLike & { items: RecordLike[] };
type CatalogEntry = {
  path: string;
  names: string[];
  codes: string[];
  depth: number;
};

type PickerSelection = {
  large: string;
  middle: string;
  small: string;
  detail: string;
};

const EMPTY_SELECTION: PickerSelection = {
  large: "",
  middle: "",
  small: "",
  detail: "",
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pathKey(value: unknown) {
  return text(value)
    .replace(/[＞→]/g, ">")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}

function normalizePastedPath(value: unknown) {
  return text(value)
    .replace(/[＞→]/g, ">")
    .replace(/\t+/g, ">")
    .replace(/\s*>\s*/g, ">");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "ko-KR"),
  );
}

function isReviewItem(item: RecordLike) {
  if (item.archivedAt) return false;
  const status = text(item.categoryAiStatus);
  return status === "review_required" || status === "review_held";
}

function reviewLabel(item: RecordLike) {
  return `${text(item.modelNumber) || "모델번호 없음"} · ${
    text(item.productName) || "모델명 없음"
  }`;
}

export function ShoplingCategoryManualPicker() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogHash, setCatalogHash] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selection, setSelection] = useState<PickerSelection>(EMPTY_SELECTION);
  const [pastedPath, setPastedPath] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readServerState(), readCatalog()])
      .then(([nextState, nextCatalog]) => {
        if (cancelled) return;
        if (nextState) setState(nextState);
        if (nextCatalog) {
          setCatalog(nextCatalog.categories);
          setCatalogHash(nextCatalog.hash);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewItems = useMemo(
    () =>
      (state?.items ?? [])
        .filter(isReviewItem)
        .sort((left, right) =>
          reviewLabel(left).localeCompare(reviewLabel(right), "ko-KR"),
        ),
    [state],
  );
  const metrics = useMemo(
    () => computeShoplingCategoryAccuracyMetrics(state),
    [state],
  );
  const catalogPathByKey = useMemo(
    () => new Map(catalog.map((entry) => [pathKey(entry.path), entry.path])),
    [catalog],
  );
  const selectedItem = useMemo(
    () => reviewItems.find((item) => text(item.id) === selectedItemId) ?? null,
    [reviewItems, selectedItemId],
  );

  useEffect(() => {
    if (!selectedItemId && reviewItems.length) {
      setSelectedItemId(text(reviewItems[0].id));
    }
    if (
      selectedItemId &&
      !reviewItems.some((item) => text(item.id) === selectedItemId)
    ) {
      setSelectedItemId(text(reviewItems[0]?.id));
    }
  }, [reviewItems, selectedItemId]);

  useEffect(() => {
    setSelection(EMPTY_SELECTION);
    setPastedPath("");
    setManualPath("");
    setNotice("");
  }, [selectedItemId]);

  const largeOptions = useMemo(
    () => unique(catalog.map((entry) => entry.names[0]).filter(Boolean)),
    [catalog],
  );
  const middleOptions = useMemo(
    () =>
      unique(
        catalog
          .filter((entry) => entry.names[0] === selection.large)
          .map((entry) => entry.names[1])
          .filter(Boolean),
      ),
    [catalog, selection.large],
  );
  const smallOptions = useMemo(
    () =>
      unique(
        catalog
          .filter(
            (entry) =>
              entry.names[0] === selection.large &&
              entry.names[1] === selection.middle,
          )
          .map((entry) => entry.names[2])
          .filter(Boolean),
      ),
    [catalog, selection.large, selection.middle],
  );
  const detailOptions = useMemo(
    () =>
      unique(
        catalog
          .filter(
            (entry) =>
              entry.names[0] === selection.large &&
              entry.names[1] === selection.middle &&
              entry.names[2] === selection.small,
          )
          .map((entry) => entry.names[3])
          .filter(Boolean),
      ),
    [catalog, selection.large, selection.middle, selection.small],
  );

  const cascadePath = useMemo(() => {
    const names = [
      selection.large,
      selection.middle,
      selection.small,
      selection.detail,
    ].filter(Boolean);
    if (!names.length) return "";
    const exact = catalog.find(
      (entry) =>
        entry.names.length === names.length &&
        entry.names.every((name, index) => name === names[index]),
    );
    return exact?.path ?? "";
  }, [catalog, selection]);

  useEffect(() => {
    if (cascadePath) setManualPath(cascadePath);
  }, [cascadePath]);

  function selectLarge(value: string) {
    setSelection({ large: value, middle: "", small: "", detail: "" });
    setManualPath("");
  }

  function selectMiddle(value: string) {
    setSelection((current) => ({
      ...current,
      middle: value,
      small: "",
      detail: "",
    }));
    setManualPath("");
  }

  function selectSmall(value: string) {
    setSelection((current) => ({ ...current, small: value, detail: "" }));
    setManualPath("");
  }

  function selectDetail(value: string) {
    setSelection((current) => ({ ...current, detail: value }));
    setManualPath("");
  }

  function applyPastedPath() {
    const normalized = normalizePastedPath(pastedPath);
    const matched = catalogPathByKey.get(pathKey(normalized));
    if (!matched) {
      setManualPath("");
      setNotice(
        "붙여넣은 경로가 현재 샵플링 7,259개 카탈로그와 정확히 일치하지 않습니다. 대→중→소→세 선택으로 확인하세요.",
      );
      return;
    }
    const entry = catalog.find((candidate) => candidate.path === matched);
    setManualPath(matched);
    if (entry) {
      setSelection({
        large: entry.names[0] ?? "",
        middle: entry.names[1] ?? "",
        small: entry.names[2] ?? "",
        detail: entry.names[3] ?? "",
      });
    }
    setNotice("현재 샵플링 카탈로그와 일치하는 실제 경로를 찾았습니다.");
  }

  async function approveManualPath() {
    if (saving || !selectedItem || !manualPath) return;
    const canonical = catalogPathByKey.get(pathKey(manualPath));
    if (!canonical) {
      setNotice("현재 샵플링 카탈로그에 없는 경로는 승인할 수 없습니다.");
      return;
    }
    const confirmed = window.confirm(
      `${reviewLabel(selectedItem)}\n\n${canonical}\n\n이 샵플링 카테고리로 직접 승인하시겠습니까?`,
    );
    if (!confirmed) return;

    setSaving(true);
    setNotice("");
    try {
      const latest = await readServerState();
      if (!latest) throw new Error("최신 진행관리 데이터를 불러오지 못했습니다.");
      const current = latest.items.find(
        (item) => text(item.id) === text(selectedItem.id),
      );
      if (!current || !isReviewItem(current)) {
        throw new Error("이 상품은 이미 다른 곳에서 처리되었거나 검토 대상이 아닙니다.");
      }
      const result = applyShoplingCategoryReviewDecisions(
        latest,
        [
          {
            itemId: text(selectedItem.id),
            action: "approve",
            category: canonical,
          },
        ],
        { reviewer: "AI 카테고리 검토함 · 수동 카탈로그 지정" },
      );
      await persistState(result.state as TrackerState);
      setNotice(`${reviewLabel(selectedItem)} · 수동 지정 카테고리를 승인했습니다.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "수동 카테고리 승인에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function persistState(next: TrackerState) {
    const response = await fetch(STATE_ENDPOINT, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ state: next }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "카테고리 결과를 저장하지 못했습니다.");
    }
    setState(next);
    window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(next));
  }

  if (loading) {
    return (
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-700 shadow-sm">
        수동 카테고리 선택기와 승인 정확도 데이터를 불러오고 있습니다.
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            수동 샵플링 카테고리 지정
          </p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            실제 카탈로그를 대 → 중 → 소 → 세 순서로 직접 고릅니다
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            드롭다운 선택과 전체 경로 복붙을 모두 지원합니다. 현재 저장된 샵플링 카탈로그에 실제 존재하지 않는 경로는 승인되지 않습니다.
          </p>
        </div>
        <div className="grid min-w-[320px] grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="font-bold text-slate-500">정답 누적</p>
            <p className="mt-1 text-lg font-black text-slate-950">{metrics.approvedCount}</p>
          </div>
          <div className="rounded-xl bg-blue-50 px-3 py-2">
            <p className="font-bold text-blue-600">Top-1</p>
            <p className="mt-1 text-lg font-black text-blue-900">{metrics.top1Rate}%</p>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <p className="font-bold text-emerald-600">Top-3</p>
            <p className="mt-1 text-lg font-black text-emerald-900">{metrics.top3Rate}%</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="text-xs font-black text-slate-600">검토 상품 선택</label>
        <select
          value={selectedItemId}
          onChange={(event) => setSelectedItemId(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
        >
          {!reviewItems.length ? <option value="">검토할 상품이 없습니다</option> : null}
          {reviewItems.map((item) => (
            <option key={text(item.id)} value={text(item.id)}>
              {reviewLabel(item)}
            </option>
          ))}
        </select>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CategorySelect
            label="1. 대카테고리"
            value={selection.large}
            options={largeOptions}
            onChange={selectLarge}
          />
          <CategorySelect
            label="2. 중카테고리"
            value={selection.middle}
            options={middleOptions}
            onChange={selectMiddle}
            disabled={!selection.large}
          />
          <CategorySelect
            label="3. 소카테고리"
            value={selection.small}
            options={smallOptions}
            onChange={selectSmall}
            disabled={!selection.middle}
          />
          <CategorySelect
            label="4. 세카테고리"
            value={selection.detail}
            options={detailOptions}
            onChange={selectDetail}
            disabled={!selection.small || !detailOptions.length}
            optional={!detailOptions.length}
          />
        </div>

        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
          <p className="text-xs font-black text-emerald-700">현재 선택된 실제 경로</p>
          <p className="mt-1 break-words text-sm font-black text-emerald-950">
            {manualPath || "대→중→소→세를 선택하거나 아래에 전체 경로를 붙여넣으세요."}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2 lg:flex-row">
          <input
            value={pastedPath}
            onChange={(event) => setPastedPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyPastedPath();
              }
            }}
            placeholder="예: 생활/건강>청소용품>청소도구>... 전체 경로 복붙"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <button
            type="button"
            onClick={applyPastedPath}
            className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-xs font-black text-emerald-800"
          >
            붙여넣은 경로 확인
          </button>
          <button
            type="button"
            onClick={() => void approveManualPath()}
            disabled={!selectedItem || !manualPath || saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:bg-slate-300"
          >
            {saving ? "수동 승인 저장 중…" : "이 수동 경로 승인"}
          </button>
        </div>
        {notice ? (
          <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900">
            {notice}
          </p>
        ) : null}
        <p className="mt-3 text-[11px] text-slate-500">
          카탈로그 {catalog.length.toLocaleString("ko-KR")}개 · snapshot {catalogHash.slice(0, 12) || "확인 중"}
        </p>
      </div>
    </section>
  );
}

function CategorySelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  optional = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  return (
    <label className="text-xs font-black text-slate-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <option value="">{optional ? "세분류 없음 / 선택" : "선택"}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

async function readServerState(): Promise<TrackerState | null> {
  try {
    const response = await fetch(STATE_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.state?.items)) {
      return null;
    }
    return body.state as TrackerState;
  } catch {
    return null;
  }
}

async function readCatalog(): Promise<{
  categories: CatalogEntry[];
  hash: string;
} | null> {
  try {
    const response = await fetch(CATALOG_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.categories)) {
      return null;
    }
    const categories = body.categories
      .map((raw: unknown) => {
        const row = raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as RecordLike)
          : null;
        if (!row) return null;
        const path = text(row.path);
        const names = Array.isArray(row.names)
          ? row.names.map(text).filter(Boolean).slice(0, 4)
          : path.split(/\s*>\s*/g).map(text).filter(Boolean).slice(0, 4);
        const codes = Array.isArray(row.codes)
          ? row.codes.map(text).filter(Boolean).slice(0, 4)
          : [];
        return path && names.length
          ? { path, names, codes, depth: Number(row.depth) || names.length }
          : null;
      })
      .filter((entry: CatalogEntry | null): entry is CatalogEntry => Boolean(entry));
    return { categories, hash: text(body.hash) };
  } catch {
    return null;
  }
}
