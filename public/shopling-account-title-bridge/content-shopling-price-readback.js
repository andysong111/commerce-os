(() => {
  "use strict";

  const PAGE_MESSAGE = "commerce-os-shopling-price-readback-page-result";
  const BRIDGE_VERSION = "browser-price-dom-v0.6.3";
  const MAX_WAIT_MS = 15000;
  const POLL_MS = 500;

  const MALLS = [
    ["SMALL_00101", "카카오톡 스토어", ["카카오톡스토어", "카카오 스토어"]],
    ["SMALL_00004", "스마트스토어", ["네이버 스마트스토어"]],
    ["SMALL_00019", "신세계몰", ["신세계"]],
    ["SMALL_00071", "도매창고", []],
    ["SMALL_00107", "오너클랜", ["오늘클렌"]],
    ["SMALL_00194", "토스쇼핑", ["토스 쇼핑"]],
    ["SMALL_00014", "카페24", ["카페24(1.9)", "Cafe24"]],
    ["SMALL_00130", "롯데ON", ["롯데온"]],
    ["SMALL_00005", "GS SHOP", ["GS샵", "GS SHOP"]],
    ["SMALL_00003", "11번가", []],
    ["SMALL_00002", "지마켓", ["G마켓"]],
    ["SMALL_00001", "옥션", []],
    ["SMALL_00012", "쿠팡", []],
    ["SMALL_00069", "도매꾹", []],
    ["SMALL_00112", "에이블리", []],
    ["SMALL_00116", "셀파", []],
    ["SMALL_00165", "셀링콕", ["셀링콕"]],
    ["SMALL_00168", "인터파크", []],
    ["SMALL_00179", "투비즈온", []],
    ["SMALL_00180", "도매아토즈", []],
    ["SMALL_00188", "셀러어스", []],
    ["SMALL_00190", "도매의신", []],
  ];

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function canonical(value) {
    return text(value).replace(/\s+/g, "").toLowerCase();
  }

  function integer(value) {
    const normalized = String(value ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  function pageContext() {
    const params = new URLSearchParams(location.search);
    return {
      enabled:
        location.hostname === "a.shopling.co.kr" &&
        location.pathname.endsWith("/prod/prodShopInfo.phtml") &&
        params.get("mode") === "price_chg" &&
        params.get("commerce_os_price_readback") === "1",
      goodsKey: text(params.get("prod_id")),
      runId: text(params.get("commerce_os_readback_run")),
      taskId: text(params.get("commerce_os_readback_task")),
      attempt: integer(params.get("commerce_os_readback_attempt")),
    };
  }

  function fieldValue(element) {
    if (!element) return "";
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return text(element.value);
    }
    const input = element.querySelector?.("input:not([type='hidden']), textarea, select");
    if (input) return fieldValue(input);
    return text(element.innerText || element.textContent || "");
  }

  function mallIdentity(row) {
    const html = String(row.innerHTML || "");
    const explicit = html.match(/SMALL_\d{5}/i)?.[0]?.toUpperCase() || "";
    if (explicit) {
      const known = MALLS.find(([key]) => key === explicit);
      return { mallKey: explicit, mallName: known?.[1] || explicit };
    }
    const rowText = canonical(row.innerText || row.textContent || "");
    for (const [mallKey, mallName, aliases] of MALLS) {
      const names = [mallName, ...aliases].map(canonical).filter(Boolean);
      if (names.some((name) => rowText.includes(name))) return { mallKey, mallName };
    }
    return { mallKey: "", mallName: "" };
  }

  function headerMapping(table) {
    const rows = [...table.querySelectorAll("tr")];
    for (const row of rows.slice(0, 8)) {
      const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
      if (!cells.length) continue;
      const labels = cells.map((cell) => text(cell.innerText || cell.textContent || ""));
      const consumerIndex = labels.findIndex((label) => /소비자가/.test(label));
      const sellIndex = labels.findIndex((label) => /판매가/.test(label));
      const purchaseIndex = labels.findIndex((label) => /매입가|원가/.test(label));
      if (consumerIndex >= 0 && sellIndex >= 0 && purchaseIndex >= 0) {
        return { headerRow: row, consumerIndex, sellIndex, purchaseIndex };
      }
    }
    return null;
  }

  function namedInputPrices(row) {
    let sellPrice = null;
    let purchasePrice = null;
    let consumerPrice = null;
    for (const input of row.querySelectorAll("input, textarea, select")) {
      const key = `${input.getAttribute("name") || ""} ${input.id || ""}`.toLowerCase();
      const raw = fieldValue(input);
      if (!raw && input instanceof HTMLInputElement && input.type === "hidden") continue;
      const value = integer(raw);
      if (/list[_-]?price|consumer|소비/.test(key)) consumerPrice = value;
      else if (/org[_-]?price|purchase|buy[_-]?price|cost|매입|원가/.test(key)) purchasePrice = value;
      else if (/sale[_-]?price|sell[_-]?price|판매/.test(key)) sellPrice = value;
    }
    return {
      sellPrice,
      purchasePrice,
      consumerPrice,
      complete: sellPrice !== null && purchasePrice !== null && consumerPrice !== null,
      source: "input_name",
    };
  }

  function positionalInputPrices(row) {
    const values = [...row.querySelectorAll("input:not([type='hidden']), textarea, select")]
      .filter((input) => {
        const key = `${input.getAttribute("name") || ""} ${input.id || ""}`;
        return !/margin|rate|마진|퍼센트|percent/i.test(key) && !/%/.test(fieldValue(input));
      })
      .map((input) => integer(fieldValue(input)));
    if (values.length < 3) return null;
    return {
      consumerPrice: values[0],
      sellPrice: values[1],
      purchasePrice: values[2],
      source: "input_position",
    };
  }

  function rowPrices(row, mapping) {
    const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
    if (mapping && cells.length > Math.max(mapping.consumerIndex, mapping.sellIndex, mapping.purchaseIndex)) {
      return {
        consumerPrice: integer(fieldValue(cells[mapping.consumerIndex])),
        sellPrice: integer(fieldValue(cells[mapping.sellIndex])),
        purchasePrice: integer(fieldValue(cells[mapping.purchaseIndex])),
        source: "header",
      };
    }
    const named = namedInputPrices(row);
    if (named.complete) {
      return {
        sellPrice: Number(named.sellPrice || 0),
        purchasePrice: Number(named.purchasePrice || 0),
        consumerPrice: Number(named.consumerPrice || 0),
        source: named.source,
      };
    }
    return positionalInputPrices(row);
  }

  function accountLabel(row) {
    const cells = [...row.querySelectorAll(":scope > td")];
    if (!cells.length) return "";
    const candidates = cells
      .slice(0, 5)
      .map((cell) => text(cell.innerText || cell.textContent || ""))
      .filter(Boolean);
    return candidates.join(" · ").slice(0, 120);
  }

  function collectObservedRows() {
    const observed = [];
    const seen = new Set();
    for (const table of document.querySelectorAll("table")) {
      const mapping = headerMapping(table);
      const rows = [...table.querySelectorAll("tr")];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (mapping?.headerRow === row) continue;
        const identity = mallIdentity(row);
        if (!identity.mallKey) continue;
        const prices = rowPrices(row, mapping);
        if (!prices) continue;
        const signature = `${identity.mallKey}:${prices.sellPrice}:${prices.purchasePrice}:${prices.consumerPrice}:${index}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        observed.push({
          mallKey: identity.mallKey,
          mallName: identity.mallName,
          sellPrice: prices.sellPrice,
          purchasePrice: prices.purchasePrice,
          consumerPrice: prices.consumerPrice,
          accountLabel: accountLabel(row),
          rowIndex: index + 1,
          source: prices.source,
        });
      }
    }
    return observed;
  }

  function sendResult(context, observedRows, error = "") {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: PAGE_MESSAGE,
            bridgeVersion: BRIDGE_VERSION,
            runId: context.runId,
            taskId: context.taskId,
            goodsKey: context.goodsKey,
            attempt: context.attempt,
            observedRows,
            error: text(error),
            pageUrl: location.href,
            pageTitle: document.title,
          },
          (response) => {
            void chrome.runtime.lastError;
            resolve(response || null);
          },
        );
      } catch {
        resolve(null);
      }
    });
  }

  async function run() {
    const context = pageContext();
    if (!context.enabled) return;
    if (!/^\d{5,9}$/.test(context.goodsKey) || !context.runId || !context.taskId) {
      await sendResult(context, [], "Price readback page identity is invalid.");
      return;
    }
    const startedAt = Date.now();
    let best = [];
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      const rows = collectObservedRows();
      if (rows.length > best.length) best = rows;
      if (rows.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const stableRows = collectObservedRows();
        if (stableRows.length >= rows.length) {
          await sendResult(context, stableRows);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const body = text(document.body?.innerText || "");
    const loginHint = /로그인|login|아이디|비밀번호/i.test(body.slice(0, 1800));
    await sendResult(
      context,
      best,
      best.length
        ? "Shopling 가격행은 일부 읽었지만 가격 테이블이 안정화되지 않았습니다."
        : loginHint
          ? "Shopling 로그인 세션 또는 가격 화면 접근을 확인해야 합니다."
          : "Shopling 쇼핑몰별 가격행을 찾지 못했습니다. DOM 구조 변경 여부를 확인해야 합니다.",
    );
  }

  void run();
})();
