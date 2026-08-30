(() => {
  "use strict";

  const BRIDGE_ID = "commerce-os-shopling-account-title-bridge";
  const STATUS_ID = `${BRIDGE_ID}-status`;
  const ACTION_BUTTON_ID = `${BRIDGE_ID}-action`;
  const MAX_TITLE_BYTES = 100;
  const BATCH_PAGE_MESSAGE = "commerce-os-shopling-title-batch-page";
  const SEO_KEYWORD_POOL_MESSAGE = "commerce-os-shopling-seo-keyword-pool";
  const MARKET_NAMES = [
    "카카오톡 스토어",
    "스마트스토어",
    "신세계몰",
    "도매창고",
    "오너클랜",
    "토스쇼핑",
    "카페24(1.9)",
    "롯데ON",
    "GS SHOP",
    "11번가",
    "지마켓",
    "옥션",
    "쿠팡",
    "도매꾹",
    "에이블리",
    "셀파",
    "셀러쿡",
    "인터파크",
    "투비즈온",
    "Q텐",
    "인큐텐",
  ];

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(text(value)).length;
  }

  function canonical(value) {
    return text(value).replace(/\s+/g, "").toLowerCase();
  }

  function tokenize(value) {
    return text(value).split(/\s+/).filter(Boolean);
  }

  function tokenKey(value) {
    return canonical(value).replace(/[^0-9a-z가-힣]/gi, "");
  }

  function isUsefulToken(value) {
    const key = tokenKey(value);
    return key.length >= 2 && /[0-9a-z가-힣]/i.test(key);
  }

  function unique(values, keyFn = canonical) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
      const normalized = text(value);
      const key = keyFn(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function rotate(values, offset) {
    if (!values.length) return [];
    const normalized = ((offset % values.length) + values.length) % values.length;
    return [...values.slice(normalized), ...values.slice(0, normalized)];
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function buildVerifiedTokenPool(rows) {
    const tokens = [];
    for (const row of rows) {
      for (const token of tokenize(row.currentTitle)) {
        if (isUsefulToken(token)) tokens.push(token);
      }
    }
    return unique(tokens, tokenKey).slice(0, 48);
  }

  async function loadSeoMasterTokenPool(goodsKey) {
    const response = await sendRuntimeMessage({
      type: SEO_KEYWORD_POOL_MESSAGE,
      goodsKey,
    });
    const keywords = response?.ok && Array.isArray(response.keywords) ? response.keywords : [];
    const tokens = [];
    for (const keyword of keywords) {
      for (const token of tokenize(keyword)) {
        if (isUsefulToken(token)) tokens.push(token);
      }
    }
    return {
      tokens: unique(tokens, tokenKey).slice(0, 64),
      candidateCount: Number(response?.candidateCount || keywords.length || 0),
      source: text(response?.source || "none"),
    };
  }

  function titleVariants(baseTitle, identity, fallbackPool, fallbackMode, limit = 96) {
    const baseTokens = tokenize(baseTitle);
    if (!baseTokens.length) return [];

    const candidates = [];
    const seen = new Set();
    const add = (values, mode) => {
      const candidate = text(values.join(" "));
      const key = canonical(candidate);
      if (!candidate || !key || seen.has(key) || utf8Bytes(candidate) > MAX_TITLE_BYTES) return;
      seen.add(key);
      candidates.push({ title: candidate, mode });
    };

    add(baseTokens, "reorder");
    if (baseTokens.length >= 2) {
      for (let offset = 1; offset < baseTokens.length; offset += 1) {
        add(rotate(baseTokens, offset), "reorder");
      }
      add([...baseTokens].reverse(), "reorder");
      for (let index = 1; index < baseTokens.length; index += 1) {
        const swapped = [...baseTokens];
        [swapped[0], swapped[index]] = [swapped[index], swapped[0]];
        add(swapped, "reorder");
      }
      for (let index = 0; index < baseTokens.length - 1; index += 1) {
        const swapped = [...baseTokens];
        [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
        add(swapped, "reorder");
      }
    }

    const baseKeys = new Set(baseTokens.map(tokenKey));
    const extras = fallbackPool.filter((token) => {
      const key = tokenKey(token);
      return key && !baseKeys.has(key);
    });
    const orderedExtras = rotate(
      extras,
      extras.length ? stableHash(identity) % extras.length : 0,
    );

    for (const extra of orderedExtras.slice(0, 24)) {
      add([...baseTokens, extra], fallbackMode);
      add([extra, ...baseTokens], fallbackMode);
      if (baseTokens.length >= 2) {
        add([baseTokens[0], extra, ...baseTokens.slice(1)], fallbackMode);
        add([...baseTokens.slice(0, -1), extra, baseTokens.at(-1)], fallbackMode);
      }
    }

    for (let left = 0; left < Math.min(orderedExtras.length, 10); left += 1) {
      for (let right = left + 1; right < Math.min(orderedExtras.length, 10); right += 1) {
        add([...baseTokens, orderedExtras[left], orderedExtras[right]], fallbackMode);
        add([orderedExtras[right], ...baseTokens, orderedExtras[left]], fallbackMode);
      }
    }

    if (candidates.length <= 1) return candidates;
    const offset = stableHash(identity) % candidates.length;
    return rotate(candidates, offset).slice(0, limit);
  }

  function marketNameFromRow(row) {
    const cells = [...row.querySelectorAll(":scope > td")];
    const direct = text(cells[2]?.innerText || cells[2]?.textContent || "");
    if (direct && MARKET_NAMES.includes(direct)) return direct;
    const rowText = text(row.innerText || row.textContent || "");
    return MARKET_NAMES.find((name) => rowText.includes(name)) || "";
  }

  function loginIdFromRow(row) {
    const cells = [...row.querySelectorAll(":scope > td")];
    return text(cells[3]?.innerText || cells[3]?.textContent || "");
  }

  function titleInputFromRow(row) {
    const cells = [...row.querySelectorAll(":scope > td")];
    const preferred = cells[4]?.querySelector(
      'input[type="text"]:not([disabled]):not([readonly]), input:not([type]):not([disabled]):not([readonly])',
    );
    if (preferred) return preferred;
    const inputs = [...row.querySelectorAll('input[type="text"]:not([disabled]):not([readonly])')];
    return inputs.find((input) => String(input.type || "text").toLowerCase() === "text") || null;
  }

  function isMallTitlePage() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    const params = new URLSearchParams(location.search);
    return params.get("mode") === "nm_chg" && /^\d+$/.test(params.get("prod_id") || "");
  }

  function collectEditableRows() {
    if (!isMallTitlePage()) return [];
    const result = [];
    for (const row of document.querySelectorAll("tr")) {
      const marketName = marketNameFromRow(row);
      if (!marketName) continue;
      const input = titleInputFromRow(row);
      if (!input) continue;
      const currentTitle = text(input.value);
      if (!currentTitle || utf8Bytes(currentTitle) > MAX_TITLE_BYTES) continue;
      result.push({
        row,
        input,
        marketName,
        loginId: loginIdFromRow(row),
        currentTitle,
      });
    }
    return result;
  }

  function groupRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      const current = groups.get(row.marketName) || [];
      current.push(row);
      groups.set(row.marketName, current);
    }
    return groups;
  }

  function analyzeDuplicates(rows = collectEditableRows()) {
    const groups = groupRows(rows);
    let duplicateGroupCount = 0;
    let duplicateRowCount = 0;
    const duplicateMarkets = [];
    for (const [marketName, marketRows] of groups.entries()) {
      const counts = new Map();
      for (const row of marketRows) {
        const key = canonical(row.currentTitle);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const repeated = [...counts.values()].filter((count) => count > 1);
      if (!repeated.length) continue;
      duplicateGroupCount += repeated.length;
      duplicateRowCount += repeated.reduce((sum, count) => sum + count, 0);
      duplicateMarkets.push(marketName);
    }
    return { duplicateGroupCount, duplicateRowCount, duplicateMarkets };
  }

  function buildGroupAssignments(
    marketName,
    marketRows,
    goodsKey,
    fallbackPool,
    fallbackMode,
    retryAttempt,
  ) {
    if (marketRows.length < 2) return [];
    const byTitle = new Map();
    for (const row of marketRows) {
      const key = canonical(row.currentTitle);
      const current = byTitle.get(key) || [];
      current.push(row);
      byTitle.set(key, current);
    }

    const occupied = new Set();
    for (const [titleKey, rows] of byTitle.entries()) {
      if (rows.length === 1) occupied.add(titleKey);
    }

    const assignments = [];
    for (const duplicateRows of byTitle.values()) {
      if (duplicateRows.length < 2) continue;
      const baseTitle = duplicateRows[0].currentTitle;
      const variants = titleVariants(
        baseTitle,
        `${goodsKey}:${marketName}:${baseTitle}:${fallbackMode}:attempt-${retryAttempt}`,
        fallbackPool,
        fallbackMode,
        Math.max(96, duplicateRows.length * 16),
      );

      for (const row of duplicateRows) {
        let selected = null;
        for (const candidate of variants) {
          const key = canonical(candidate.title);
          if (!occupied.has(key)) {
            selected = candidate;
            occupied.add(key);
            break;
          }
        }
        if (selected) assignments.push({ row, ...selected });
      }
    }
    return assignments;
  }

  function dispatchValueEvents(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyPass(goodsKey, fallbackPool, fallbackMode, retryAttempt) {
    const rows = collectEditableRows();
    const groups = groupRows(rows);
    let changed = 0;
    let fallbackUsed = 0;
    const changedMarkets = [];

    for (const [marketName, marketRows] of groups.entries()) {
      const assignments = buildGroupAssignments(
        marketName,
        marketRows,
        goodsKey,
        fallbackPool,
        fallbackMode,
        retryAttempt,
      );
      if (!assignments.length) continue;
      let marketChanged = 0;
      for (const assignment of assignments) {
        const input = assignment.row.input;
        const next = text(assignment.title);
        if (!next || utf8Bytes(next) > MAX_TITLE_BYTES || text(input.value) === next) continue;
        input.value = next;
        input.dataset.commerceOsOriginalTitle = assignment.row.currentTitle;
        input.dataset.commerceOsDiversified = "1";
        input.dataset.commerceOsDiversifyMode = assignment.mode;
        input.style.outline = "2px solid #7c3aed";
        input.style.outlineOffset = "1px";
        dispatchValueEvents(input);
        changed += 1;
        marketChanged += 1;
        if (assignment.mode === fallbackMode) fallbackUsed += 1;
      }
      if (marketChanged) changedMarkets.push(`${marketName} ${marketChanged}개`);
    }

    return { changed, fallbackUsed, changedMarkets };
  }

  async function applyDiversification(retryAttempt = 0) {
    const goodsKey = new URLSearchParams(location.search).get("prod_id") || "";
    const initialRows = collectEditableRows();
    const localPool = buildVerifiedTokenPool(initialRows);
    const localPass = applyPass(
      goodsKey,
      localPool,
      "verified_pool",
      retryAttempt,
    );

    let seoPool = { tokens: [], candidateCount: 0, source: "none" };
    let seoPass = { changed: 0, fallbackUsed: 0, changedMarkets: [] };
    let after = analyzeDuplicates(collectEditableRows());

    if (after.duplicateGroupCount > 0) {
      seoPool = await loadSeoMasterTokenPool(goodsKey);
      if (seoPool.tokens.length) {
        seoPass = applyPass(
          goodsKey,
          seoPool.tokens,
          "seo_master_pool",
          retryAttempt,
        );
        after = analyzeDuplicates(collectEditableRows());
      }
    }

    return {
      goodsKey,
      totalEditableRows: initialRows.length,
      verifiedPoolSize: localPool.length,
      seoPoolSize: seoPool.tokens.length,
      seoCandidateCount: seoPool.candidateCount,
      changed: localPass.changed + seoPass.changed,
      fallbackUsed: localPass.fallbackUsed,
      seoFallbackUsed: seoPass.fallbackUsed,
      changedMarkets: unique([
        ...localPass.changedMarkets,
        ...seoPass.changedMarkets,
      ]),
      remainingDuplicates: after.duplicateGroupCount,
      remainingMarkets: after.duplicateMarkets,
    };
  }

  function findNativeSaveButton() {
    const rows = collectEditableRows();
    const form = rows[0]?.input?.closest("form") || document.querySelector("form");
    const scopes = [form, document].filter(Boolean);
    for (const scope of scopes) {
      const candidates = [...scope.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
      const found = candidates.find((element) => {
        if (element.id === ACTION_BUTTON_ID || element.closest(`#${BRIDGE_ID}`)) return false;
        if (element.disabled) return false;
        const label = text(element.value || element.innerText || element.textContent || "");
        return label === "저장" || label === "저장하기";
      });
      if (found) return found;
    }
    return null;
  }

  function setStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#334155";
  }

  function setActionBusy(busy, label = "") {
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.style.opacity = busy ? "0.6" : "1";
    if (label) button.textContent = label;
  }

  async function runManualSingle() {
    const before = analyzeDuplicates();
    if (!before.duplicateGroupCount) {
      setStatus("이 goods key는 같은 쇼핑몰 내 중복 상품명이 없습니다.", "success");
      return;
    }
    setActionBusy(true, "SEO 원장 확인 중...");
    const result = await applyDiversification(0);
    if (!result.changed || result.remainingDuplicates > 0) {
      setActionBusy(false, "분산·저장");
      setStatus(
        `Shopling 기존 제목 + SEO 원장 검증키워드까지 사용했지만 ${result.remainingDuplicates || before.duplicateGroupCount}개 중복 그룹이 남았습니다.`,
        "error",
      );
      return;
    }
    const saveButton = findNativeSaveButton();
    if (!saveButton) {
      setActionBusy(false, "분산·저장");
      setStatus("분산은 완료했지만 Shopling 저장 버튼을 찾지 못했습니다.", "error");
      return;
    }
    setActionBusy(true, "저장 중...");
    const seoText = result.seoFallbackUsed
      ? ` · SEO원장 보강 ${result.seoFallbackUsed}개`
      : "";
    setStatus(`상품명 ${result.changed}개 분산${seoText} 후 Shopling에 저장합니다.`, "success");
    setTimeout(() => saveButton.click(), 250);
  }

  function makePanel() {
    const box = document.createElement("div");
    box.id = BRIDGE_ID;
    box.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483647",
      "width:340px",
      "padding:12px",
      "border:1px solid #c4b5fd",
      "border-radius:10px",
      "background:#ffffff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)",
      "font:12px/1.45 Arial, sans-serif",
      "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 계정별 상품명 분산";
    title.style.cssText = "font-weight:700;margin-bottom:6px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "같은 쇼핑몰 로그인 ID 중복은 Shopling 제목을 먼저 쓰고, 부족할 때 Commerce OS SEO 원장의 검증키워드만 보강합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = ACTION_BUTTON_ID;
    button.type = "button";
    button.textContent = "분산·저장";
    button.style.cssText = "width:100%;padding:8px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", runManualSingle);

    box.append(title, status, button);
    document.documentElement.appendChild(box);
  }

  function mountControls() {
    if (document.getElementById(BRIDGE_ID) || !isMallTitlePage()) return;
    const params = new URLSearchParams(location.search);
    if (params.get("commerce_os_batch") === "1" || params.get("commerce_os_verify") === "1") return;
    makePanel();
  }

  async function runBatchWorkerPage() {
    if (!isMallTitlePage()) return;
    const params = new URLSearchParams(location.search);
    const goodsKey = params.get("prod_id") || "";
    const runId = params.get("commerce_os_run") || "";
    const retryAttempt = Math.max(0, Number(params.get("commerce_os_attempt") || 0) || 0);

    if (params.get("commerce_os_verify") === "1") {
      const analysis = analyzeDuplicates();
      await sendRuntimeMessage({
        type: BATCH_PAGE_MESSAGE,
        phase: "verify",
        runId,
        goodsKey,
        retryAttempt,
        success: analysis.duplicateGroupCount === 0,
        duplicateGroupCount: analysis.duplicateGroupCount,
        duplicateRowCount: analysis.duplicateRowCount,
        duplicateMarkets: analysis.duplicateMarkets,
      });
      return;
    }

    if (params.get("commerce_os_batch") !== "1") return;
    const before = analyzeDuplicates();
    if (!before.duplicateGroupCount) {
      await sendRuntimeMessage({
        type: BATCH_PAGE_MESSAGE,
        phase: "noop",
        runId,
        goodsKey,
        retryAttempt,
      });
      return;
    }

    const result = await applyDiversification(retryAttempt);
    if (!result.changed || result.remainingDuplicates > 0) {
      await sendRuntimeMessage({
        type: BATCH_PAGE_MESSAGE,
        phase: "unresolved",
        runId,
        goodsKey,
        retryAttempt,
        reasonCode: "seo_keyword_pool_insufficient",
        duplicateGroupCount: result.remainingDuplicates || before.duplicateGroupCount,
        duplicateMarkets: result.remainingMarkets.length ? result.remainingMarkets : before.duplicateMarkets,
        verifiedPoolSize: result.verifiedPoolSize,
        seoPoolSize: result.seoPoolSize,
        seoCandidateCount: result.seoCandidateCount,
        fallbackUsed: result.fallbackUsed,
        seoFallbackUsed: result.seoFallbackUsed,
        message: `Shopling 제목 + SEO 원장 pool까지 사용했지만 중복 ${result.remainingDuplicates || before.duplicateGroupCount}그룹이 남았습니다.`,
      });
      return;
    }

    const saveButton = findNativeSaveButton();
    if (!saveButton) {
      await sendRuntimeMessage({
        type: BATCH_PAGE_MESSAGE,
        phase: "failure",
        runId,
        goodsKey,
        retryAttempt,
        reasonCode: "save_button_missing",
        message: "Shopling 저장 버튼을 찾지 못했습니다.",
      });
      return;
    }

    await sendRuntimeMessage({
      type: BATCH_PAGE_MESSAGE,
      phase: "saving",
      runId,
      goodsKey,
      retryAttempt,
      changed: result.changed,
      fallbackUsed: result.fallbackUsed,
      seoFallbackUsed: result.seoFallbackUsed,
      verifiedPoolSize: result.verifiedPoolSize,
      seoPoolSize: result.seoPoolSize,
    });
    setTimeout(() => saveButton.click(), 250);
  }

  const params = new URLSearchParams(location.search);
  if (params.get("commerce_os_batch") === "1" || params.get("commerce_os_verify") === "1") {
    setTimeout(runBatchWorkerPage, 650);
  } else {
    mountControls();
  }
})();
