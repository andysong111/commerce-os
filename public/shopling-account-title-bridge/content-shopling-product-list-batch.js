(() => {
  "use strict";

  const PANEL_ID = "commerce-os-shopling-product-list-batch";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const DETAILS_ID = `${PANEL_ID}-details`;
  const BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
  const BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
  const LAST_RUN_STORAGE_KEY = "commerceOsShoplingTitleBatchLastRun";
  const MAX_BATCH_GOODS_KEYS = 500;
  const MAX_LIST_PAGES = 30;

  const REASON_LABELS = {
    keyword_pool_insufficient: "검증 키워드 재료 부족",
    save_verify_duplicate: "저장 후 중복 잔존",
    batch_timeout: "상품명 화면 60초 timeout",
    verify_timeout: "저장 검증 60초 timeout",
    save_button_missing: "Shopling 저장 버튼 탐지 실패",
    open_failed: "Shopling 작업 페이지 열기 실패",
    worker_failure: "Shopling 작업 처리 실패",
    unknown: "원인 미분류",
  };

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function goodsKeysFromRaw(raw) {
    const value = String(raw || "");
    const result = [];
    const patterns = [
      /(?:prod_id|prodId|goods_key|goodsKey)\s*(?:=|%3D|[:"'\s])+\s*(\d{5,9})/gi,
      /(?:prod_id|goods_key)%3D(\d{5,9})/gi,
    ];
    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) result.push(match[1]);
    }
    return result;
  }

  function looksLikeProductRow(row) {
    const rowText = text(row.innerText || row.textContent || "");
    if (!rowText) return false;
    if (!/(?:복사생성|\[사입\]|\[위탁\]|상품명)/.test(rowText)) return false;
    const actions = [...row.querySelectorAll("a,button,input")]
      .map((node) => text(node.value || node.innerText || node.textContent || ""))
      .join(" ");
    return /(?:수정|복사생성|일반)/.test(`${rowText} ${actions}`);
  }

  function extractGoodsKeysFromDocument(doc) {
    const result = new Set();
    for (const row of doc.querySelectorAll("tr")) {
      if (!looksLikeProductRow(row)) continue;
      let foundInAttributes = false;
      for (const node of row.querySelectorAll("a[href], [onclick], form[action], input[name], input[id]")) {
        const rawValues = [
          node.getAttribute("href"),
          node.getAttribute("onclick"),
          node.getAttribute("action"),
          `${node.getAttribute("name") || ""}=${node.getAttribute("value") || ""}`,
          `${node.getAttribute("id") || ""}=${node.getAttribute("value") || ""}`,
        ];
        for (const raw of rawValues) {
          for (const goodsKey of goodsKeysFromRaw(raw)) {
            result.add(goodsKey);
            foundInAttributes = true;
          }
        }
      }
      if (!foundInAttributes) {
        const rowText = text(row.innerText || row.textContent || "");
        const fallback = rowText.match(/\b\d{6,7}\b/);
        if (fallback) result.add(fallback[0]);
      }
    }
    return [...result].filter((value) => /^\d{5,9}$/.test(value));
  }

  function expectedResultCount(doc) {
    const bodyText = text(doc.body?.innerText || doc.body?.textContent || "");
    const match = bodyText.match(/총\s*조회수\s*[:：]?\s*([\d,]+)\s*건/);
    if (!match) return 0;
    return Number(match[1].replace(/,/g, "")) || 0;
  }

  function isProductListDocument() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    const params = new URLSearchParams(location.search);
    if (params.has("prod_id") || params.get("popup") === "Y") return false;
    if (params.get("mode") === "modify" || params.get("mode") === "nm_chg") return false;
    const bodyText = text(document.body?.innerText || document.body?.textContent || "");
    if (!/총\s*조회수/.test(bodyText)) return false;
    return extractGoodsKeysFromDocument(document).length > 0;
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

  function setStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#334155";
  }

  function setButtonBusy(busy, label = "") {
    const button = document.getElementById(BUTTON_ID);
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

  function failureReason(failure) {
    const code = text(failure?.reasonCode) || "unknown";
    return REASON_LABELS[code] || failure?.message || code;
  }

  function renderFailures(failures, labelPrefix = "최종 확인필요") {
    const host = document.getElementById(DETAILS_ID);
    if (!host) return;
    host.replaceChildren();
    const rows = Array.isArray(failures) ? failures : [];
    if (!rows.length) return;

    const details = document.createElement("details");
    details.style.cssText = "margin-top:8px;border-top:1px solid #ede9fe;padding-top:7px";
    const summary = document.createElement("summary");
    summary.textContent = `${labelPrefix} ${rows.length}건 · goods key/사유 보기`;
    summary.style.cssText = "cursor:pointer;font-weight:700;color:#b91c1c";
    details.appendChild(summary);

    const list = document.createElement("div");
    list.style.cssText = "margin-top:6px;max-height:180px;overflow:auto;font:11px/1.5 Arial,sans-serif;color:#475569";
    for (const failure of rows) {
      const item = document.createElement("div");
      item.style.cssText = "padding:4px 0;border-bottom:1px dotted #e2e8f0";
      const goodsKey = text(failure?.goodsKey) || "goods key 미상";
      const attempts = Number(failure?.attempts || 0);
      const markets = Array.isArray(failure?.duplicateMarkets) && failure.duplicateMarkets.length
        ? ` · ${failure.duplicateMarkets.join(",")}`
        : "";
      item.textContent = `${goodsKey} · ${failureReason(failure)}${attempts ? ` · ${attempts}회 시도` : ""}${markets}`;
      list.appendChild(item);
    }
    details.appendChild(list);
    host.appendChild(details);
  }

  async function showLastRunIfUseful() {
    try {
      const stored = await chrome.storage.local.get(LAST_RUN_STORAGE_KEY);
      const run = stored?.[LAST_RUN_STORAGE_KEY];
      if (!run || run.status !== "completed") return;
      if (Number(run.failed || 0) > 0) renderFailures(run.failures, "최근 실행 확인필요");
    } catch {
      // Diagnostics are optional; never block the batch button.
    }
  }

  async function collectBatchGoodsKeys() {
    const expected = expectedResultCount(document);
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
      setStatus(
        `조회결과 수집 중 · ${seenPages.size}페이지 · ${goodsKeys.size}${expected ? `/${expected}` : ""}건`,
        "info",
      );
      try {
        const doc = await fetchShoplingDocument(url);
        for (const goodsKey of extractGoodsKeysFromDocument(doc)) goodsKeys.add(goodsKey);
        for (const nextUrl of extractPaginationUrls(doc, url)) {
          if (!seenPages.has(nextUrl) && !queue.includes(nextUrl)) queue.push(nextUrl);
        }
      } catch {
        // Incomplete collection is detected against 총 조회수 below.
      }
    }

    return {
      expected,
      goodsKeys: [...goodsKeys]
        .filter((value) => /^\d{5,9}$/.test(value))
        .slice(0, MAX_BATCH_GOODS_KEYS)
        .sort((left, right) => Number(left) - Number(right)),
      scannedPages: seenPages.size,
    };
  }

  async function runBatch() {
    renderFailures([]);
    setButtonBusy(true, "조회결과 수집 중...");
    setStatus("현재 상품조회 조건의 모든 goods key를 수집합니다.", "info");

    const collected = await collectBatchGoodsKeys();
    if (!collected.goodsKeys.length) {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus("현재 조회결과에서 goods key를 찾지 못했습니다.", "error");
      return;
    }

    if (collected.expected > collected.goodsKeys.length) {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus(
        `전체 조회결과 수집이 덜 됐습니다: ${collected.goodsKeys.length}/${collected.expected}건. 일부만 처리하지 않고 중단했습니다.`,
        "error",
      );
      return;
    }

    setStatus(
      `조회된 상품 ${collected.goodsKeys.length}건을 확보했습니다. 미분산 상품만 자동복구 포함 순차 처리합니다.`,
      "info",
    );
    const response = await sendRuntimeMessage({
      type: BATCH_START_MESSAGE,
      goodsKeys: collected.goodsKeys,
    });
    if (!response?.ok) {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus(response?.message || "일괄 처리를 시작하지 못했습니다.", "error");
      return;
    }
    setButtonBusy(true, `일괄 처리 중 0/${collected.goodsKeys.length}`);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID) || !isProductListDocument()) return;

    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "width:370px",
      "padding:12px",
      "border:1px solid #c4b5fd",
      "border-radius:10px",
      "background:#ffffff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)",
      "font:12px/1.45 Arial, sans-serif",
      "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 조회상품 일괄 분산";
    title.style.cssText = "font-weight:700;margin-bottom:6px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    const expected = expectedResultCount(document);
    status.textContent = expected
      ? `현재 조회결과 ${expected}건 전체를 대상으로 미분산 상품만 처리합니다.`
      : "현재 조회결과 전체를 대상으로 미분산 상품만 처리합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "미분산 상품 일괄 처리";
    button.style.cssText = "width:100%;padding:9px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", runBatch);

    const detailHost = document.createElement("div");
    detailHost.id = DETAILS_ID;

    box.append(title, status, button, detailHost);
    document.documentElement.appendChild(box);
    void showLastRunIfUseful();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== BATCH_PROGRESS_MESSAGE) return;
    if (!document.getElementById(PANEL_ID)) return;
    const total = Number(message.total || 0);
    const done = Number(message.done || 0);
    const changed = Number(message.changed || 0);
    const autoRecovered = Number(message.autoRecovered || 0);
    const skipped = Number(message.skipped || 0);
    const failed = Number(message.failed || 0);
    const retryCount = Number(message.retryCount || 0);

    if (message.status === "completed") {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus(
        `완료 · ${done}/${total} · 분산저장 ${changed}${autoRecovered ? ` (자동복구 ${autoRecovered} 포함)` : ""} · 기존정상 ${skipped} · 최종확인 ${failed}`,
        failed ? "error" : "success",
      );
      renderFailures(message.failures || []);
      return;
    }

    const retryText = message.retrying
      ? ` · 자동재시도 ${Number(message.currentAttempt || 0) + 1}/3`
      : retryCount
        ? ` · 누적재시도 ${retryCount}`
        : "";
    setButtonBusy(true, `일괄 처리 중 ${done}/${total}`);
    setStatus(
      `진행 ${done}/${total} · 분산저장 ${changed} · 자동복구 ${autoRecovered} · 기존정상 ${skipped} · 확인필요 ${failed}${message.goodsKey ? ` · ${message.goodsKey}` : ""}${retryText}`,
      "info",
    );
  });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    mountPanel();
    if (document.getElementById(PANEL_ID) || attempts >= 20) clearInterval(timer);
  }, 500);
  mountPanel();
})();
