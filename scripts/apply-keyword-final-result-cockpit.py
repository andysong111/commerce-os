from pathlib import Path

path = Path("src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"expected snippet not found:\n{old[:500]}")
    text = text.replace(old, new, 1)


replace_once(
    '''  const [autoRunning, setAutoRunning] = useState(false);
  const runningRef = useRef(false);''',
    '''  const [autoRunning, setAutoRunning] = useState(false);
  const [resultSession, setResultSession] = useState<ExtendedSession | null>(null);
  const [copied, setCopied] = useState(false);
  const runningRef = useRef(false);''',
)

replace_once(
    '''  }, []);

  async function runPipeline(initial: ExtendedSession, marker: AutoRunMarker) {''',
    '''  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncResult = () => {
      if (cancelled) return;
      const current = readSession();
      setResultSession(current);
      setCopied(false);
      setUrl((previous) => previous || current?.source.url || "");
    };
    const initialTimer = window.setTimeout(syncResult, 0);
    window.addEventListener("keyword-elon-session-updated", syncResult);
    window.addEventListener("storage", syncResult);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.removeEventListener("keyword-elon-session-updated", syncResult);
      window.removeEventListener("storage", syncResult);
    };
  }, []);

  async function runPipeline(initial: ExtendedSession, marker: AutoRunMarker) {''',
)

replace_once(
    '''      writeSession(current);
      window.localStorage.removeItem(AUTO_RUN_KEY);
      setProgress(current.lastMessage);
      window.setTimeout(() => window.location.reload(), 700);''',
    '''      writeSession(current);
      window.localStorage.removeItem(AUTO_RUN_KEY);
      setResultSession(current);
      setCopied(false);
      setProgress(
        current.titleResult
          ? "FINAL RESULT 생성 완료 · STEP 1~4 전체 실행을 마쳤습니다."
          : current.lastMessage,
      );''',
)

replace_once(
    '''    const marker: AutoRunMarker = {
      status: "armed",''',
    '''    setResultSession(null);
    setCopied(false);
    const marker: AutoRunMarker = {
      status: "armed",''',
)

replace_once(
    '''  return (
    <section className="mx-auto mt-6 max-w-[1500px] px-5 text-slate-900">''',
    '''  const step4Complete = resultSession?.step4?.status === "done";
  const finalTitle = step4Complete
    ? resultSession?.titleResult ?? resultSession?.step4?.titleResult ?? null
    : null;
  const finalAllowedKeys = new Set(step4Complete ? resultSession?.step4?.allowedKeys ?? [] : []);
  const finalRows = step4Complete && resultSession
    ? selectKeywordElonStep4Union(resultSession.scoredCandidates, readKeywordElonSelectionThresholds()).filter((row) =>
        finalAllowedKeys.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
      )
    : [];

  async function copyFinalResult() {
    if (!finalTitle?.title) return;
    const keywordLine = finalRows.length
      ? `키워드: ${finalRows.map((row) => row.searchKeyword || row.searchKey || row.keyword).join(", ")}`
      : "";
    try {
      await navigator.clipboard.writeText([finalTitle.title, keywordLine].filter(Boolean).join("\\n"));
      setCopied(true);
    } catch {
      setError("FINAL RESULT를 클립보드에 복사하지 못했습니다.");
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-[1500px] px-5 text-slate-900">''',
)

replace_once(
    '''            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">ONE CLICK · URL → STEP 4</div>
            <h2 className="mt-1 text-xl font-black">1688 링크 하나로 STEP 4까지 일괄 실행</h2>
            <p className="mt-1 text-sm text-slate-600">브라우저 원본수집 → STEP 1 자동분석/통과 → STEP 2 round 1 → STEP 3 round 1~3 자동확장 → STEP 4 금지키워드 제거 → 최종 상품명까지 진행합니다.</p>''',
    '''            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">ONE CLICK · 1688 URL → FINAL RESULT</div>
            <h2 className="mt-1 text-xl font-black">링크 하나로 STEP 1~4 전체 실행</h2>
            <p className="mt-1 text-sm text-slate-600">1688 원본수집부터 STEP 4 위험어 제거와 최종 상품명 생성까지 자동 진행합니다. STEP 5는 자동 실행하지 않고 결과를 본 뒤 직접 선택합니다.</p>''',
)

replace_once(
    '''            링크 → STEP 4 일괄 실행
          </button>''',
    '''            {autoRunning ? "STEP 1~4 실행 중…" : "FINAL RESULT 받기"}
          </button>''',
)

replace_once(
    '''        {progress ? <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-emerald-950 ring-1 ring-emerald-200">{progress}</div> : null}
        {error ? <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}
      </div>''',
    '''        {progress ? <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-emerald-950 ring-1 ring-emerald-200">{progress}</div> : null}
        {error ? <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}

        {step4Complete ? (
          <div id="keyword-final-result" className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">FINAL RESULT</div>
                <h3 className="mt-1 text-xl font-black text-slate-950">STEP 4 완료 결과</h3>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-black">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">STEP 4 완료</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">최종 키워드 {finalRows.length}개</span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">STEP 5 자동 실행 안 함</span>
              </div>
            </div>

            {finalTitle ? (
              <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white">
                <div className="text-xs font-bold text-slate-400">추천 상품명</div>
                <div className="mt-2 text-2xl font-black leading-snug">{finalTitle.title}</div>
                <div className="mt-3 text-xs text-slate-400">{finalTitle.byteLength} bytes · model {finalTitle.model}</div>
                <button
                  type="button"
                  onClick={copyFinalResult}
                  className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-black text-slate-950"
                >
                  {copied ? "복사 완료" : "FINAL RESULT 복사"}
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                STEP 4까지 완료했지만 최종 통과 키워드가 없어 상품명을 만들지 못했습니다. 아래 STEP 1~4 세부내용을 펼쳐 원인을 확인하세요.
              </div>
            )}

            {finalRows.length ? (
              <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-slate-800 marker:content-none">
                  <span>최종 사용 키워드 {finalRows.length}개</span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-200">
                    <span className="group-open:hidden">펼쳐보기</span>
                    <span className="hidden group-open:inline">숨기기</span>
                  </span>
                </summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finalRows.map((row) => {
                    const keyword = row.searchKeyword || row.searchKey || row.keyword;
                    return <span key={compactKeywordElonKey(keyword)} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{keyword}</span>;
                  })}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>''',
)

path.write_text(text, encoding="utf-8")
