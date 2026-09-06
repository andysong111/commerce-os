// Read-only search policy. No product/option mutation occurs in this module.
(() => {
  const START = "20240101";
  const documentToken = `${Date.now()}-${Math.random()}`;
  const completed = new Map();
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function todayKst(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    return ["year", "month", "day"].map((type) => parts.find((p) => p.type === type).value).join("");
  }
  function dateValue(input, value) {
    const old = String(input.value || "");
    const sep = input.type === "date" || old.includes("-") ? "-" : old.includes("/") ? "/" : old.includes(".") ? "." : "";
    return [value.slice(0, 4), value.slice(4, 6), value.slice(6)].join(sep);
  }
  function datePair(form) {
    const inputs = [...form.querySelectorAll("input")].filter((el) => {
      const type = String(el.type || "text").toLowerCase();
      if (!["text", "date", "search"].includes(type) || !visible(el)) return false;
      const context = norm(el.closest("tr")?.textContent || el.parentElement?.textContent);
      return /^20\d{6}$/.test(digits(el.value)) && /일자|날짜|기간|등록일|date/i.test(`${context} ${el.name || ""} ${el.id || ""}`);
    });
    const pairs = [];
    for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i], b = inputs[j], ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (Math.abs(ar.top - br.top) <= 18 && (a.closest("tr") === b.closest("tr") || Math.abs(ar.left - br.left) < 240)) {
        pairs.push(ar.left <= br.left ? [a, b] : [b, a]);
      }
    }
    return pairs.length === 1 ? pairs[0] : null;
  }
  function applyPeriod(form, setInput, now = new Date()) {
    const pair = datePair(form);
    if (!pair) return { ok: false, code: "SEARCH_DATE_FIELDS_AMBIGUOUS", message: "검색 시작일·종료일을 정확히 특정하지 못해 검색을 차단했습니다." };
    const end = todayKst(now);
    if (pair.some((el) => el.disabled)) return { ok: false, code: "SEARCH_DATE_DISABLED", message: "검색 날짜 입력칸이 비활성화되어 검색을 차단했습니다." };
    for (const [index, value] of [START, end].entries()) {
      if (digits(pair[index].value) !== value) setInput(pair[index], dateValue(pair[index], value));
    }
    const evidence = { start: digits(pair[0].value), end: digits(pair[1].value), expectedStart: START, expectedEnd: end };
    if (evidence.start !== START || evidence.end !== end) return { ok: false, code: "SEARCH_DATE_VERIFY_FAILED", message: "2024-01-01~오늘 검색기간 설정값 검증에 실패했습니다.", evidence };
    return { ok: true, evidence };
  }
  async function search(fieldLabel, token, api) {
    let field = api.getField(fieldLabel);
    if (!field) return { ok: false, code: "SEARCH_FIELD_NOT_FOUND", message: `${fieldLabel} 검색항목을 찾지 못했습니다.` };
    let input = api.findInput(field);
    const scope = `${api.scope}:${location.pathname}:${fieldLabel}:${token}`;
    const key = `commerce-stock-search-v023:${scope}`;
    let ticket = null;
    try { ticket = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { /* no usable ticket */ }
    const inDateRange = (e) => e?.start === START && e?.end === todayKst();
    const form = field.form || field.closest("form") || document;
    const pair = datePair(form);
    const currentPeriod = pair ? { start: digits(pair[0].value), end: digits(pair[1].value) } : null;
    const selectedLabel = norm(field.options?.[field.selectedIndex]?.textContent);
    const queryMatches = input && norm(input.value).toUpperCase() === norm(token).toUpperCase() && selectedLabel === fieldLabel && inDateRange(currentPeriod);
    // A search may reload only the inner frame. Resume that submitted query instead of submitting forever.
    const resumed = ticket && ticket.documentToken !== documentToken && Date.now() - ticket.at < 90_000 && queryMatches;
    if (resumed || (completed.has(scope) && queryMatches)) {
      const rows = await api.waitFor(() => { const found = api.rows(token); return found.length ? found : null; }, 2_500, 150);
      if (!rows?.length) return { ok: false, code: "EXACT_RESULT_NOT_FOUND", message: `${token} 정확 일치 검색결과가 없습니다. 검색기간: 2024-01-01~${todayKst()}`, evidence: currentPeriod };
      completed.set(scope, true);
      return { ok: true, rows, fieldLabel, period: currentPeriod };
    }
    if (!api.selectField(field, fieldLabel)) return { ok: false, code: "SEARCH_FIELD_NOT_FOUND", message: `${fieldLabel} 검색항목을 선택하지 못했습니다.` };
    input = await api.waitFor(() => { field = api.getField(fieldLabel) || field; return api.findInput(field); }, 6_000, 120);
    if (!input || !api.setInput(input, token)) return { ok: false, code: "SEARCH_INPUT_SET_FAILED", message: `${fieldLabel} 검색어 ${token}을 입력하지 못했습니다.` };
    const period = applyPeriod(input.form || form, api.setInput);
    if (!period.ok) return period;
    // Some old date widgets redraw their paired input on change; read the live controls again.
    await api.sleep(120);
    const livePair = datePair(input.form || form);
    if (!livePair || digits(livePair[0].value) !== START || digits(livePair[1].value) !== todayKst()) {
      return { ok: false, code: "SEARCH_DATE_VERIFY_FAILED", message: "검색 직전 날짜가 변경되어 실행을 차단했습니다." };
    }
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), documentToken, period: period.evidence })); }
    catch { return { ok: false, code: "SEARCH_CONTINUATION_STORAGE_FAILED", message: "검색 후 화면 복구정보를 저장하지 못해 실행을 차단했습니다." }; }
    if (!api.clickSearch(input)) return { ok: false, code: "SEARCH_BUTTON_NOT_FOUND", message: "검색 버튼을 찾지 못했습니다." };
    // [] is truthy: never use it as a successful wait predicate.
    const rows = await api.waitFor(() => { const found = api.rows(token); return found.length ? found : null; }, 20_000, 250);
    if (!rows?.length) return { ok: false, code: "EXACT_RESULT_NOT_FOUND", message: `${token} 정확 일치 검색결과가 없습니다. 검색기간: 2024-01-01~${todayKst()}`, evidence: period.evidence };
    completed.set(scope, true);
    return { ok: true, rows, fieldLabel, period: period.evidence };
  }
  globalThis.CommerceStockSearchV023 = { search, applyPeriod, datePair, todayKst };
})();
