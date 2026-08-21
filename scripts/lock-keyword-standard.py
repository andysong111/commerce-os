from pathlib import Path


def replace(path: str, old: str, new: str, *, count: int | None = None):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    found = text.count(old)
    if found == 0:
        raise SystemExit(f"expected snippet not found: {path}\n{old[:240]}")
    if count is not None and found != count:
        raise SystemExit(f"unexpected occurrence count {found} != {count}: {path}\n{old[:240]}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# STEP 2 = fixed 60. Existing browser sessions may not override the standard.
replace(
    "src/lib/keywordEngineElonLabV2.ts",
    'export const KEYWORD_ELON_V2_DEFAULT_CUTOFF = 70;',
    'export const KEYWORD_ELON_V2_DEFAULT_CUTOFF = 60;',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/page.tsx",
    '      cutoff: Number.isFinite(Number(parsed.cutoff)) ? Number(parsed.cutoff) : KEYWORD_ELON_V2_DEFAULT_CUTOFF,',
    '      cutoff: KEYWORD_ELON_V2_DEFAULT_CUTOFF,',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/page.tsx",
    '''  function changeCutoff(value: number) {
    const cutoff = Math.max(0, Math.min(100, value));
    setSession((previous) => ({
      ...previous,
      cutoff,
      titleResult: null,
      lastMessage: `품질 커트라인을 ${cutoff}점으로 변경했습니다. 상품명은 새 커트라인으로 다시 생성해 주세요.`,
      updatedAt: new Date().toISOString(),
    }));
  }

''',
    '',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/page.tsx",
    '''            <label className="flex items-center gap-3 text-sm font-bold">품질 커트라인
              <input type="number" min={0} max={100} step={1} value={session.cutoff} onChange={(event) => changeCutoff(Number(event.target.value))} className="w-20 rounded-lg border px-3 py-2" />점
            </label>''',
    '''            <span className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-black text-violet-950">표준 품질 커트라인 60점 · 고정</span>''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/page.tsx",
    '              1688 실제 화면에서 중국 상품명·옵션을 수집하고 상품 정체성을 확정한 뒤, 품질 커트라인을 넘는 키워드를 개수 제한 없이 보존해 상품명까지 만듭니다.',
    '              1688 실제 화면에서 중국 상품명·옵션을 수집하고 상품 정체성을 확정한 뒤, 검증된 표준값(STEP2 60 · 월검색 품질 65 · 정확성 90)으로 키워드를 선별해 상품명까지 만듭니다.',
    count=1,
)

# Final dual selection = fixed demand quality 65 / accuracy relevance 90.
replace(
    "src/lib/keywordEngineElonLabV2Selection.ts",
    'export const KEYWORD_ELON_DEFAULT_DEMAND_QUALITY = 60;',
    'export const KEYWORD_ELON_DEFAULT_DEMAND_QUALITY = 65;',
    count=1,
)
replace(
    "src/lib/keywordEngineElonLabV2Selection.ts",
    '''export function normalizeKeywordElonSelectionThresholds(
  value?: Partial<KeywordElonSelectionThresholds> | null,
): KeywordElonSelectionThresholds {
  return {
    demandQuality: clampKeywordElonThreshold(
      value?.demandQuality,
      KEYWORD_ELON_DEFAULT_DEMAND_QUALITY,
    ),
    accuracyRelevance: clampKeywordElonThreshold(
      value?.accuracyRelevance,
      KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE,
    ),
  };
}''',
    '''export function normalizeKeywordElonSelectionThresholds(
  _value?: Partial<KeywordElonSelectionThresholds> | null,
): KeywordElonSelectionThresholds {
  return {
    demandQuality: KEYWORD_ELON_DEFAULT_DEMAND_QUALITY,
    accuracyRelevance: KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE,
  };
}''',
    count=1,
)
replace(
    "src/lib/keywordEngineElonLabV2Selection.ts",
    '''export function readKeywordElonSelectionThresholds(): KeywordElonSelectionThresholds {
  if (typeof window === "undefined") return normalizeKeywordElonSelectionThresholds();
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_SELECTION_STORAGE_KEY);
    if (!raw) return normalizeKeywordElonSelectionThresholds();
    return normalizeKeywordElonSelectionThresholds(JSON.parse(raw) as Partial<KeywordElonSelectionThresholds>);
  } catch {
    return normalizeKeywordElonSelectionThresholds();
  }
}''',
    '''export function readKeywordElonSelectionThresholds(): KeywordElonSelectionThresholds {
  return normalizeKeywordElonSelectionThresholds();
}''',
    count=1,
)
replace(
    "src/lib/keywordEngineElonLabV2Selection.ts",
    '''export function writeKeywordElonSelectionThresholds(value: KeywordElonSelectionThresholds) {
  if (typeof window === "undefined") return;
  const normalized = normalizeKeywordElonSelectionThresholds(value);
  window.localStorage.setItem(KEYWORD_ELON_SELECTION_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("keyword-elon-selection-thresholds-updated"));
}''',
    '''export function writeKeywordElonSelectionThresholds(_value: KeywordElonSelectionThresholds) {
  if (typeof window === "undefined") return;
  const normalized = normalizeKeywordElonSelectionThresholds();
  window.localStorage.setItem(KEYWORD_ELON_SELECTION_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("keyword-elon-selection-thresholds-updated"));
}''',
    count=1,
)

# Remove demand/accuracy numeric editors and persistence listeners from UI.
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '''  selectKeywordElonStep4Union,
  writeKeywordElonSelectionThresholds,
  type KeywordElonSelectionThresholds,''',
    '''  selectKeywordElonStep4Union,''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '  const [thresholds, setThresholds] = useState<KeywordElonSelectionThresholds>(() => ({ demandQuality: 60, accuracyRelevance: 90 }));',
    '  const thresholds = useMemo(() => readKeywordElonSelectionThresholds(), []);',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '''    setThresholds(readKeywordElonSelectionThresholds());
    let last = "";''',
    '''    let last = "";''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '''    const thresholdListener = () => setThresholds(readKeywordElonSelectionThresholds());
    window.addEventListener("keyword-elon-selection-thresholds-updated", thresholdListener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-selection-thresholds-updated", thresholdListener);
    };''',
    '''    return () => {
      window.clearInterval(timer);
    };''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '''  function updateThreshold(field: keyof KeywordElonSelectionThresholds, value: number) {
    const next = { ...thresholds, [field]: Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : thresholds[field])) };
    setThresholds(next);
    writeKeywordElonSelectionThresholds(next);
  }

''',
    '',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '            <p className="mt-2 text-sm text-slate-600">실제 시장 문서와 SearchAd에서 모은 후보를 수요와 상품 정확성 두 개의 그물로 따로 선별합니다. 각 기준은 아래에서 직접 조절할 수 있습니다.</p>',
    '            <p className="mt-2 text-sm text-slate-600">실제 시장 문서와 SearchAd에서 모은 후보를 수요와 상품 정확성 두 개의 그물로 따로 선별합니다. 10개 상품 × 64조합 실험으로 확정한 표준값을 고정 적용합니다.</p>',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '''              <label className="flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-black text-blue-950">품질점수 ≥
                <input type="number" min={0} max={100} step={1} value={thresholds.demandQuality} onChange={(event) => updateThreshold("demandQuality", Number(event.target.value))} className="w-16 rounded-lg border border-blue-200 px-2 py-1 text-right tabular-nums" />
              </label>''',
    '''              <span className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-black text-blue-950">표준 품질점수 ≥ 65 · 고정</span>''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx",
    '''              <label className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-950">관련성 ≥
                <input type="number" min={0} max={100} step={1} value={thresholds.accuracyRelevance} onChange={(event) => updateThreshold("accuracyRelevance", Number(event.target.value))} className="w-16 rounded-lg border border-emerald-200 px-2 py-1 text-right tabular-nums" />
              </label>''',
    '''              <span className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-950">표준 관련성 ≥ 90 · 고정</span>''',
    count=1,
)

# STEP4 reads immutable selection values directly. Custom blocked terms remain editable.
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonStep4DualFilter.tsx",
    '  const [thresholds, setThresholds] = useState<KeywordElonSelectionThresholds>(() => ({ demandQuality: 60, accuracyRelevance: 90 }));',
    '  const thresholds = useMemo(() => readKeywordElonSelectionThresholds(), []);',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonStep4DualFilter.tsx",
    '''    setThresholds(readKeywordElonSelectionThresholds());
    setCustomTerms(readCustomBlockedTerms());
    let last = "";''',
    '''    const customInitTimer = window.setTimeout(() => setCustomTerms(readCustomBlockedTerms()), 0);
    let last = "";''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonStep4DualFilter.tsx",
    '''    const thresholdListener = () => setThresholds(readKeywordElonSelectionThresholds());
    const customListener = () => setCustomTerms(readCustomBlockedTerms());
    window.addEventListener("keyword-elon-selection-thresholds-updated", thresholdListener);
    window.addEventListener("keyword-elon-step4-custom-terms-updated", customListener);''',
    '''    const customListener = () => setCustomTerms(readCustomBlockedTerms());
    window.addEventListener("keyword-elon-step4-custom-terms-updated", customListener);''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonStep4DualFilter.tsx",
    '''      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-selection-thresholds-updated", thresholdListener);
      window.removeEventListener("keyword-elon-step4-custom-terms-updated", customListener);''',
    '''      window.clearTimeout(customInitTimer);
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-step4-custom-terms-updated", customListener);''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonStep4DualFilter.tsx",
    '        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">안전 Gate 관련성 80 / 쇼핑의도 70은 고정입니다. 상품정확성 경로는 품질점수가 낮아도 관련성 기준을 통과하면 STEP 4 재료로 들어오므로, 검색량이 작은 정확한 롱테일 키워드를 보존할 수 있습니다.</div>',
    '        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">표준값은 STEP2 품질 60 / 월검색 품질 65 / 상품정확성 관련성 90으로 고정합니다. 안전 Gate 관련성 80 / 쇼핑의도 70도 고정이며, 정확성 경로는 검색량이 작은 정확한 롱테일 키워드를 보존합니다.</div>',
    count=1,
)

# One-click parity: force STEP2=60 and feed the 65/90 dual-selection union to STEP4.
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,''',
    '''  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import type { KeywordElonStep4FilterResult } from "@/lib/keywordEngineElonLabV2Step4";''',
    '''import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import {
  readKeywordElonSelectionThresholds,
  selectKeywordElonStep4Union,
  type KeywordElonSelectionThresholds,
} from "@/lib/keywordEngineElonLabV2Selection";
import type { KeywordElonStep4FilterResult } from "@/lib/keywordEngineElonLabV2Step4";''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''function fingerprint(candidates: KeywordElonCandidate[], cutoff: number, customTerms: string[]) {
  return [
    `auto:1`,
    `cutoff:${cutoff}`,
    `custom:${customTerms.join(",")}`,
    ...candidates.map((row) => `${compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)}:${row.qualityScore.toFixed(2)}`),
  ].join("|");
}''',
    '''function fingerprint(
  candidates: KeywordElonCandidate[],
  thresholds: KeywordElonSelectionThresholds,
  customTerms: string[],
  round: number,
) {
  return [
    "dual-selection:v1",
    `demandQuality:${thresholds.demandQuality}`,
    `accuracyRelevance:${thresholds.accuracyRelevance}`,
    `round:${round}`,
    `custom:${customTerms.join(",")}`,
    ...candidates.map((row) => `${compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)}:${row.qualityScore.toFixed(2)}:${row.relevance.toFixed(0)}`),
  ].join("|");
}''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const runningRef = useRef(false);''',
    '''  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [autoRunning, setAutoRunning] = useState(false);
  const runningRef = useRef(false);''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''      runningRef.current = true;
      writeMarker({ ...marker, status: "running", message: "수집 완료 · STEP 1 자동분석 시작" });''',
    '''      runningRef.current = true;
      setAutoRunning(true);
      writeMarker({ ...marker, status: "running", message: "수집 완료 · STEP 1 자동분석 시작" });''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''      void runPipeline(session, marker).finally(() => {
        runningRef.current = false;
      });''',
    '''      void runPipeline(session, marker).finally(() => {
        runningRef.current = false;
        setAutoRunning(false);
      });''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''        stage2Round: 0,
        step3: undefined,''',
    '''        stage2Round: 0,
        cutoff: KEYWORD_ELON_V2_DEFAULT_CUTOFF,
        step3: undefined,''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '''      setProgress("일괄 실행 6/6 · STEP 4 위험·사용자 금지키워드 제거 중…");
      const finalCandidates = passingRows(current);
      const customBlockedTerms = readCustomBlockedTerms();''',
    '''      setProgress("일괄 실행 6/6 · 표준 월검색 품질 65 / 정확성 90 합집합에 STEP 4 위험필터 적용 중…");
      const selectionThresholds = readKeywordElonSelectionThresholds();
      const finalCandidates = selectKeywordElonStep4Union(current.scoredCandidates, selectionThresholds);
      const customBlockedTerms = readCustomBlockedTerms();''',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '            inputFingerprint: fingerprint(finalCandidates, current.cutoff, customBlockedTerms),',
    '            inputFingerprint: fingerprint(finalCandidates, selectionThresholds, customBlockedTerms, current.step3?.round ?? 3),',
    count=2,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '            cutoff: current.cutoff,',
    '            cutoff: 0,',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '          lastMessage: `일괄 실행 완료 · STEP 4까지 완료 · 최종 재료 ${filtered.result.allowedCount}개`,',
    '          lastMessage: `일괄 실행 완료 · 표준값 60 / 65 / 90 · STEP 4 최종 재료 ${filtered.result.allowedCount}개`,',
    count=1,
)
replace(
    "src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx",
    '            disabled={!collectorReady || runningRef.current}',
    '            disabled={!collectorReady || autoRunning}',
    count=1,
)

# Move runPipeline before the effect that calls it (React hooks immutability lint).
auto_path = Path("src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx")
auto = auto_path.read_text(encoding="utf-8")
block_start = auto.index("  async function runPipeline(")
block_end = auto.index("\n\n  return (", block_start)
block = auto[block_start:block_end]
auto_without = auto[:block_start] + auto[block_end:]
invoke_effect = "\n\n  useEffect(() => {\n    let cancelled = false;"
insert_at = auto_without.index(invoke_effect)
auto = auto_without[:insert_at] + "\n\n" + block + auto_without[insert_at:]
auto_path.write_text(auto, encoding="utf-8")

# Contract tests now encode the locked standard.
replace(
    "tests/keywordEngineElonLabStep4.test.mjs",
    '''test("demand and accuracy thresholds are separately editable and persisted", () => {
  assert.match(selection, /KEYWORD_ELON_DEFAULT_DEMAND_QUALITY = 60/);
  assert.match(selection, /KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE = 90/);
  assert.match(selection, /keywordEngineElonLab\\.selectionThresholds\\.v1/);
  assert.match(demandSummary, /품질점수 ≥/);
  assert.match(demandSummary, /관련성 ≥/);
  assert.match(demandSummary, /updateThreshold\\("demandQuality"/);
  assert.match(demandSummary, /updateThreshold\\("accuracyRelevance"/);
  assert.match(demandSummary, /writeKeywordElonSelectionThresholds/);
});''',
    '''test("demand and accuracy standards are locked at 65 and 90 with no numeric editor", () => {
  assert.match(selection, /KEYWORD_ELON_DEFAULT_DEMAND_QUALITY = 65/);
  assert.match(selection, /KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE = 90/);
  assert.match(selection, /demandQuality: KEYWORD_ELON_DEFAULT_DEMAND_QUALITY/);
  assert.match(selection, /accuracyRelevance: KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE/);
  assert.doesNotMatch(demandSummary, /type="number"/);
  assert.doesNotMatch(demandSummary, /updateThreshold/);
  assert.doesNotMatch(demandSummary, /writeKeywordElonSelectionThresholds/);
  assert.match(demandSummary, /표준 품질점수 ≥ 65 · 고정/);
  assert.match(demandSummary, /표준 관련성 ≥ 90 · 고정/);
});''',
    count=1,
)
replace(
    "tests/keywordEngineElonLabRoundsAndAuto.test.mjs",
    '''test("STEP 2 is a persisted cumulative round rather than a destructive rerun", () => {
  assert.match(core, /stage2Round: number/);''',
    '''test("STEP 2 is a persisted cumulative round with the locked 60-point standard", () => {
  assert.match(core, /KEYWORD_ELON_V2_DEFAULT_CUTOFF = 60/);
  assert.match(core, /stage2Round: number/);''',
    count=1,
)
replace(
    "tests/keywordEngineElonLabRoundsAndAuto.test.mjs",
    '''  assert.match(page, /기존 결과 누적/);
});''',
    '''  assert.match(page, /기존 결과 누적/);
  assert.match(page, /표준 품질 커트라인 60점 · 고정/);
  assert.doesNotMatch(page, /changeCutoff/);
});''',
    count=1,
)
replace(
    "tests/keywordEngineElonLabRoundsAndAuto.test.mjs",
    '''  assert.match(auto, /keywordEngineElonLab\\.step4\\.customBlockedTerms\\.v1/);
  assert.match(auto, /action: "filter_prohibited_keywords"/);''',
    '''  assert.match(auto, /keywordEngineElonLab\\.step4\\.customBlockedTerms\\.v1/);
  assert.match(auto, /selectKeywordElonStep4Union/);
  assert.match(auto, /readKeywordElonSelectionThresholds/);
  assert.match(auto, /cutoff: 0/);
  assert.match(auto, /action: "filter_prohibited_keywords"/);''',
    count=1,
)

# Delete all one-shot migration machinery from the resulting feature commit.
for path in [
    ".github/workflows/keyword-standard-lock-migration.yml",
    ".github/workflows/keyword-standard-lock-pr.yml",
    "scripts/lock-keyword-standard.py",
]:
    p = Path(path)
    if p.exists():
        p.unlink()
