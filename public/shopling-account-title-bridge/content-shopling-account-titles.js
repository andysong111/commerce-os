(() => {
  "use strict";

  const BRIDGE_ID = "commerce-os-shopling-account-title-bridge";
  const STATUS_ID = `${BRIDGE_ID}-status`;
  const BUTTON_ID = `${BRIDGE_ID}-save`;
  const PREVIEW_BUTTON_ID = `${BRIDGE_ID}-preview`;
  const MAX_TITLE_BYTES = 100;
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
    for (let offset = 1; offset < tokens.length; offset += 1) {
      add(rotate(tokens, offset));
    }

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
    const rotated = rotate(deduped, offset);
    const originalKey = canonical(title);
    rotated.sort((left, right) => {
      const leftOriginal = canonical(left) === originalKey ? 0 : 1;
      const rightOriginal = canonical(right) === originalKey ? 0 : 1;
      if (leftOriginal !== rightOriginal) return leftOriginal - rightOriginal;
      const leftLead = canonical(tokenize(left)[0] || "");
      const rightLead = canonical(tokenize(right)[0] || "");
      if (leftLead !== rightLead) return leftLead.localeCompare(rightLead, "ko");
      return left.localeCompare(right, "ko");
    });
    return rotated.slice(0, limit);
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
    return inputs.find((input) => {
      const type = String(input.type || "text").toLowerCase();
      return type === "text" && !input.closest("th");
    }) || null;
  }

  function collectEditableRows() {
    if (location.hostname !== "a.shopling.co.kr") return [];
    const params = new URLSearchParams(location.search);
    if (params.get("mode") !== "nm_chg") return [];
    if (!/^\d+$/.test(params.get("prod_id") || "")) return [];

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
      const key = row.marketName;
      const current = groups.get(key) || [];
      current.push(row);
      groups.set(key, current);
    }
    return groups;
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
        if (!selected) selected = baseTitle;
        assignments.push({ row, title: selected });
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
    let unresolvedDuplicates = 0;
    const changedMarkets = [];

    for (const [marketName, marketRows] of groups.entries()) {
      const assignments = buildGroupAssignments(marketName, marketRows, goodsKey);
      if (!assignments.length) continue;
      let marketChanged = 0;
      const seen = new Set();
      for (const assignment of assignments) {
        const input = assignment.row.input;
        const next = text(assignment.title);
        if (!next || utf8Bytes(next) > MAX_TITLE_BYTES) continue;
        const key = canonical(next);
        if (seen.has(key)) unresolvedDuplicates += 1;
        seen.add(key);
        if (text(input.value) !== next) {
          input.value = next;
          input.dataset.commerceOsOriginalTitle = assignment.row.currentTitle;
          input.dataset.commerceOsDiversified = "1";
          input.style.outline = "2px solid #7c3aed";
          input.style.outlineOffset = "1px";
          dispatchValueEvents(input);
          changed += 1;
          marketChanged += 1;
        }
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
      unresolvedDuplicates,
      changedMarkets,
    };
  }

  function findNativeSaveButton() {
    const rows = collectEditableRows();
    const form = rows[0]?.input?.closest("form") || document.querySelector("form");
    const scope = form || document;
    const candidates = [...scope.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
    return candidates.find((element) => {
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

  function preview() {
    const result = applyDiversification();
    if (!result.totalEditableRows) {
      setStatus("적용 가능한 기존 상품명이 없습니다. 빈 상품명은 자동으로 채우지 않습니다.", "error");
      return result;
    }
    if (!result.changed) {
      setStatus("같은 쇼핑몰 안에서 완전히 같은 상품명 중 안전하게 순서를 바꿀 대상이 없습니다.", "info");
      return result;
    }
    const extra = result.unresolvedDuplicates
      ? ` · 재료 부족 ${result.unresolvedDuplicates}건`
      : "";
    setStatus(
      `${result.changedMarkets.join(" · ")} 분산 완료${extra}. 보라색 테두리만 변경됐습니다.`,
      "success",
    );
    return result;
  }

  function previewAndSave() {
    const result = preview();
    if (!result.changed) return;
    const saveButton = findNativeSaveButton();
    if (!saveButton) {
      setStatus("상품명은 분산했지만 Shopling 저장 버튼을 찾지 못했습니다. 화면의 저장 버튼을 직접 눌러주세요.", "error");
      return;
    }
    setStatus(`상품명 ${result.changed}건 분산 후 Shopling 저장을 실행합니다.`, "success");
    setTimeout(() => saveButton.click(), 250);
  }

  function mountControls() {
    if (document.getElementById(BRIDGE_ID)) return;
    const params = new URLSearchParams(location.search);
    if (location.hostname !== "a.shopling.co.kr" || params.get("mode") !== "nm_chg") return;

    const box = document.createElement("div");
    box.id = BRIDGE_ID;
    box.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483647",
      "width:320px",
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
    status.textContent = "같은 쇼핑몰의 여러 로그인 ID에 동일한 상품명이 있으면 안전하게 순서를 분산합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px";

    const previewButton = document.createElement("button");
    previewButton.id = PREVIEW_BUTTON_ID;
    previewButton.type = "button";
    previewButton.textContent = "미리 분산";
    previewButton.style.cssText = "flex:1;padding:7px;border:1px solid #8b5cf6;border-radius:7px;background:#fff;color:#6d28d9;font-weight:700;cursor:pointer";
    previewButton.addEventListener("click", preview);

    const saveButton = document.createElement("button");
    saveButton.id = BUTTON_ID;
    saveButton.type = "button";
    saveButton.textContent = "분산 후 저장";
    saveButton.style.cssText = "flex:1;padding:7px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer";
    saveButton.addEventListener("click", previewAndSave);

    row.append(previewButton, saveButton);
    box.append(title, status, row);
    document.documentElement.appendChild(box);

    setTimeout(() => {
      const result = preview();
      if (result.changed) {
        setStatus(
          `${result.changed}개 입력칸을 미리 분산했습니다. 확인 후 ‘분산 후 저장’을 누르면 Shopling에 저장됩니다.`,
          "success",
        );
      }
    }, 350);
  }

  const params = new URLSearchParams(location.search);
  if (
    location.hostname === "a.shopling.co.kr" &&
    location.pathname.endsWith("/prod/prodShopInfo.phtml") &&
    params.get("mode") === "nm_chg" &&
    /^\d+$/.test(params.get("prod_id") || "")
  ) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountControls, { once: true });
    } else {
      mountControls();
    }
  }
})();
