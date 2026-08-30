(() => {
  "use strict";

  const BRIDGE_ID = "commerce-os-shopling-account-title-bridge";
  const STATUS_ID = `${BRIDGE_ID}-status`;
  const ACTION_BUTTON_ID = `${BRIDGE_ID}-action`;
  const MAX_TITLE_BYTES = 100;
  const MAX_BATCH_GOODS_KEYS = 500;
  const MAX_LIST_PAGES = 30;
  const BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
  const BATCH_PAGE_MESSAGE = "commerce-os-shopling-title-batch-page";
  const BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
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

  function unique(values) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
      const normalized = text(value);
      const key = canonical(normalized);
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

  function deterministicTokenOrders(title, identity, limit = 24) {
    const tokens = tokenize(title);
    if (tokens.length < 2) return [text(title)];

    const candidates = [];
    const add = (values) => {
      const candidate = text(values.join(" "));
      if (!candidate || utf8Bytes(candidate) > MAX_TITLE_BYTES) return;
      candidates.push(candidate);
    };

    add(tokens);
    for (let offset = 1; offset < tokens.length; offset += 1) add(rotate(tokens, offset));

    for (let index = 1; index < tokens.length; index += 1) {
      const swapped = [...tokens];
      [swapped[0], swapped[index]] = [swapped[index], swapped[0]];
      add(swapped);
      add([...swapped].reverse());
    }

    if (tokens.length >= 3) {
      for (let index = 0; index < tokens.length - 1; index += 1) {
        const swapped = [...tokens];
        [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
        add(swapped);
      }
    }

    const deduped = unique(candidates);
    if (deduped.length <= 1) return deduped;
    const offset = stableHash(identity) % deduped.length;
    return rotate(deduped, offset).slice(0, limit);
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
      if (!currentTitle) continue;
      if (utf8Bytes(currentTitle) > MAX_TITLE_BYTES) continue;
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

  function buildGroupAssignments(marketName, rows, goodsKey) {
    if (rows.length < 2) return [];
    const byTitle = new Map();
    for (const row of rows) {
      const key = canonical(row.currentTitle);
      const current = byTitle.get(key) || [];
      current.push(row);
      byTitle.set(key, current);
    }

    const assignments = [];
    for (const duplicateRows of byTitle.values()) {
      if (duplicateRows.length < 2) continue;
      const baseTitle = duplicateRows[0].currentTitle;
      const variants = deterministicTokenOrders(
        baseTitle,
        `${goodsKey}:${marketName}:${baseTitle}`,
        Math.max(24, duplicateRows.length * 4),
      );
      if (variants.length < 2) continue;

      const used = new Set();
      for (let index = 0; index < duplicateRows.length; index += 1) {
        const row = duplicateRows[index];
        let selected = "";
        for (let attempt = 0; attempt < variants.length; attempt += 1) {
          const candidate = variants[(index + attempt) % variants.length];
          const key = canonical(candidate);
          if (!used.has(key)) {
            selected = candidate;
            used.add(key);
            break;
          }
        }
        if (selected) assignments.push({ row, title: selected });
      }
    }
    return assignments;
  }

  function dispatchValueEvents(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyDiversification() {
    const goodsKey = new URLSearchParams(location.search).get("prod_id") || "";
    const rows = collectEditableRows();
    const groups = groupRows(rows);
    let changed = 0;
    let diversifiedMarkets = 0;
    const changedMarkets = [];

    for (const [marketName, marketRows] of groups.entries()) {
      const assignments = buildGroupAssignments(marketName, marketRows, goodsKey);
      if (!assignments.length) continue;
      let marketChanged = 0;
      for (const assignment of assignments) {
        const input = assignment.row.input;
        const next = text(assignment.title);
        if (!next || utf8Bytes(next) > MAX_TITLE_BYTES) continue;
        if (text(input.value) === next) continue;
        input.value = next;
        input.dataset.commerceOsOriginalTitle = assignment.row.currentTitle;
        input.dataset.commerceOsDiversified = "1";
        input.style.outline = "2px solid #7c3aed";
        input.style.outlineOffset = "1px";
        dispatchValueEvents(input);
        changed += 1;
        marketChanged += 1;
      }
      if (marketChanged > 0) {
        diversifiedMarkets += 1;
        changedMarkets.push(`${marketName} ${marketChanged}개`);
      }
    }

    return {
      goodsKey,
      totalEditableRows: rows.length,
      changed,
      diversifiedMarkets,
      changedMarkets,
      remainingDuplicates: analyzeDuplicates(collectEditableRows()).duplicateGroupCount,
    };
  }

  function findNativeSaveButton() {
    const rows = collectEditableRows();
    const form = rows[0]?.input?.closest("form") || document.querySelector("form");
    const scope = form || document;
    const candidates = [...scope.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
    return candidates.find((element) => {
      if (element.id === ACTION_BUTTON_ID || element.closest(`#${BRIDGE_ID}`)) return false;
      if (element.disabled) return false;
      const label = text(element.value || element.innerText || element.textContent || "");
      return label === "저장";
    }) || null;
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

  function extractGoodsKeysFromDocument(doc) {
    const result = new Set();
    const addFromRaw = (raw) => {
      const value = String(raw || "");
      const patterns = [
        /(?:prod_id|prodId|goods_key|goodsKey)\s*(?:=|%3D|[:"'\s])+\s*(\d{5,9})/gi,
        /(?:prod_id|goods_key)%3D(\d{5,9})/gi,
      ];
      for (const pattern of patterns) {
        for (const match of value.matchAll(pattern)) result.add(match[1]);
      }
    };

    for (const node of doc.querySelectorAll("a[href], [onclick], form[action], input[name], input[id]")) {
      addFromRaw(node.getAttribute("href"));
      addFromRaw(node.getAttribute("onclick"));
      addFromRaw(node.getAttribute("action"));
      const name = `${node.getAttribute("name") || ""} ${node.getAttribute("id") || ""}`;
      if (/prod|goods/i.test(name)) addFromRaw(`${name}=${node.getAttribute("value") || ""}`);
    }

    if (!result.size) {
      for (const row of doc.querySelectorAll("tr")) {
        const rowText = text(row.innerText || row.textContent || "");
        if (!/(수정|복사생성|\[사입\])/.test(rowText)) continue;
        const matches = rowText.match(/\b\d{6,8}\b/g) || [];
        for (const match of matches) result.add(match);
      }
    }

    return [...result].filter((value) => /^\d{5,9}$/.test(value));
  }

  function extractPaginationUrls(doc, baseUrl) {
    const base = new URL(baseUrl);
    const result = new Set();
    for (const anchor of doc.querySelectorAll("a[href]")) {
      const label = text(anchor.textContent || anchor.innerText || "");
      if (!/^(?:\d{1,4}|다음|next|>|»|›)$/i.test(label)) continue;
      let target;
      try {
        target = new URL(anchor.getAttribute("href") || "", base);
      } catch {
        continue;
      }
      if (target.origin !== base.origin || target.pathname !== base.pathname) continue;
      if (target.searchParams.has("prod_id")) continue;
      const hasPageSignal = [...target.searchParams.keys()].some((key) =>
        /^(?:page|pageno|page_no|cur_page|now_page|pg)$/i.test(key),
      );
      if (!hasPageSignal) continue;
      result.add(target.href);
    }
    return [...result];
  }

  async function fetchShoplingDocument(url) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Shopling 목록 조회 실패 HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), "text/html");
  }

  async function collectBatchGoodsKeys() {
    const goodsKeys = new Set(extractGoodsKeysFromDocument(document));
    const seenPages = new Set([location.href]);
    const queue = extractPaginationUrls(document, location.href);

    while (
      queue.length &&
      seenPages.size < MAX_LIST_PAGES &&
      goodsKeys.size < MAX_BATCH_GOODS_KEYS
    ) {
      const url = queue.shift();
      if (!url || seenPages.has(url)) continue;
      seenPages.add(url);
      setStatus(`상품목록 스캔 중 · ${seenPages.size}페이지 · goods key ${goodsKeys.size}개`, "info");
      try {
        const doc = await fetchShoplingDocument(url);
        for (const goodsKey of extractGoodsKeysFromDocument(doc)) goodsKeys.add(goodsKey);
        for (const nextUrl of extractPaginationUrls(doc, url)) {
          if (!seenPages.has(nextUrl) && !queue.includes(nextUrl)) queue.push(nextUrl);
        }
      } catch {
        // A failed pagination fetch must not block the current page batch.
      }
    }

    return [...goodsKeys]
      .filter((value) => /^\d{5,9}$/.test(value))
      .slice(0, MAX_BATCH_GOODS_KEYS)
      .sort((left, right) => Number(left) - Number(right));
  }

  async function runManualSingle() {
    const before = analyzeDuplicates();
    if (!before.duplicateGroupCount) {
      setStatus("이 goods key는 같은 쇼핑몰 내 중복 상품명이 없습니다.", "success");
      return;
    }
    const result = applyDiversification();
    if (!result.changed) {
      setStatus("중복은 있지만 순서를 바꿀 수 있는 키워드가 부족합니다.", "error");
      return;
    }
    const saveButton = findNativeSaveButton();
    if (!saveButton) {
      setStatus("분산은 완료했지만 Shopling 저장 버튼을 찾지 못했습니다.", "error");
      return;
    }
    setActionBusy(true, "저장 중...");
    setStatus(`상품명 ${result.changed}개를 분산하고 Shopling에 저장합니다.`, "success");
    setTimeout(() => saveButton.click(), 200);
  }

  async function runBatchFromList() {
    setActionBusy(true, "목록 스캔 중...");
    setStatus("현재 Shopling 조회조건의 goods key를 모으고 있습니다.", "info");
    const goodsKeys = await collectBatchGoodsKeys();
    if (!goodsKeys.length) {
      setActionBusy(false, "미분산 상품 일괄 처리");
      setStatus("현재 화면에서 처리할 goods key를 찾지 못했습니다.", "error");
      return;
    }
    setStatus(`goods key ${goodsKeys.length}개를 찾았습니다. 미분산 건만 순차 처리합니다.`, "info");
    const response = await sendRuntimeMessage({
      type: BATCH_START_MESSAGE,
      goodsKeys,
    });
    if (!response?.ok) {
      setActionBusy(false, "미분산 상품 일괄 처리");
      setStatus(response?.message || "일괄 처리를 시작하지 못했습니다.", "error");
      return;
    }
    setActionBusy(true, "일괄 처리 중...");
  }

  function makePanel({ batchMode }) {
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
    title.textContent = batchMode
      ? "Commerce OS · Shopling 상품명 일괄 분산"
      : "Commerce OS · 계정별 상품명 분산";
    title.style.cssText = "font-weight:700;margin-bottom:6px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = batchMode
      ? "현재 상품목록을 기준으로 미분산 goods key만 자동 처리합니다."
      : "같은 쇼핑몰의 여러 로그인 ID에 같은 제목이 있으면 분산 후 바로 저장합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = ACTION_BUTTON_ID;
    button.type = "button";
    button.textContent = batchMode ? "미분산 상품 일괄 처리" : "분산·저장";
    button.style.cssText = "width:100%;padding:8px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", batchMode ? runBatchFromList : runManualSingle);

    box.append(title, status, button);
    document.documentElement.appendChild(box);
  }

  function mountControls() {
    if (document.getElementById(BRIDGE_ID)) return;
    if (location.hostname !== "a.shopling.co.kr") return;
    const params = new URLSearchParams(location.search);
    if (params.get("commerce_os_batch") === "1" || params.get("commerce_os_verify") === "1") return;
    if (isMallTitlePage()) {
      makePanel({ batchMode: false });
      return;
    }
    if (location.pathname.startsWith("/prod/")) makePanel({ batchMode: true });
  }

  async function runBatchWorkerPage() {
    if (!isMallTitlePage()) return;
    const params = new URLSearchParams(location.search);
    const goodsKey = params.get("prod_id") || "";
    const runId = params.get("commerce_os_run") || "";

    if (params.get("commerce_os_verify") === "1") {
      const analysis = analyzeDuplicates();
      await sendRuntimeMessage({
        type: BATCH_PAGE_MESSAGE,
        phase: "verify",
        runId,
        goodsKey,
        success: analysis.duplicateGroupCount === 0,
        duplicateGroupCount: analysis.duplicateGroupCount,
        duplicateRowCount: analysis.duplicateRowCount,
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
      });
      return;
    }

    const result = applyDiversification();
    if (!result.changed) {
      await sendRuntimeMessage({
        type: BATCH_PAGE_MESSAGE,
        phase: "unresolved",
        runId,
        goodsKey,
        duplicateGroupCount: before.duplicateGroupCount,
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
        message: "Shopling 저장 버튼을 찾지 못했습니다.",
      });
      return;
    }

    await sendRuntimeMessage({
      type: BATCH_PAGE_MESSAGE,
      phase: "saving",
      runId,
      goodsKey,
      changed: result.changed,
    });
    setTimeout(() => saveButton.click(), 200);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== BATCH_PROGRESS_MESSAGE) return;
    const total = Number(message.total || 0);
    const done = Number(message.done || 0);
    const changed = Number(message.changed || 0);
    const skipped = Number(message.skipped || 0);
    const failed = Number(message.failed || 0);
    if (message.status === "completed") {
      setActionBusy(false, "미분산 상품 일괄 처리");
      setStatus(
        `완료 · ${done}/${total} · 분산저장 ${changed} · 기존정상 ${skipped} · 확인필요 ${failed}`,
        failed ? "error" : "success",
      );
      return;
    }
    setActionBusy(true, `일괄 처리 중 ${done}/${total}`);
    setStatus(
      `진행 ${done}/${total} · 분산저장 ${changed} · 기존정상 ${skipped} · 확인필요 ${failed}${message.goodsKey ? ` · ${message.goodsKey}` : ""}`,
      "info",
    );
  });

  const params = new URLSearchParams(location.search);
  if (params.get("commerce_os_batch") === "1" || params.get("commerce_os_verify") === "1") {
    setTimeout(runBatchWorkerPage, 500);
  } else {
    mountControls();
  }
})();
