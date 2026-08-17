(() => {
  const COLLECT_PARAM = "commerce_os_keyword_lab_collect";
  const RETURN_PARAM = "commerce_os_keyword_lab_return";
  const HASH_PARAM = "commerce_keyword_import";
  const GROUP_PATTERN = /(颜色|顏色|色号|花色|规格|規格|尺寸|尺码|款式|样式|樣式|型号|型號|分类|分類)/i;
  const NOISE_PATTERN = /(库存|起批|已售|销量|价格|运费|发货|服务|¥|￥|元|个起|件起|箱起|按箱|每箱|现货|定制|收藏|对比|立即下单|加采购车|跨境铺货|代发|优惠|保障|客服)/i;
  const PAGE_NOISE = new Set(["登录", "注册", "首页", "消息", "收藏", "进货单", "我的阿里", "1688首页", "联系客服"]);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cleanText(value, max = 500) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function cleanMultiline(value, max = 5000) {
    return String(value || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 2 && !PAGE_NOISE.has(line))
      .filter(Boolean)
      .join("\n")
      .slice(0, max);
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 1 &&
      rect.height > 1
    );
  }

  function directText(element) {
    if (!(element instanceof HTMLElement)) return "";
    return cleanText(
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" "),
      120,
    );
  }

  function normalizeTitle(value) {
    return cleanText(value, 300)
      .replace(/\s*[-_|]\s*(?:1688|阿里巴巴).*$/i, "")
      .replace(/阿里巴巴.*$/i, "")
      .replace(/^【[^】]{1,30}】\s*/, "")
      .trim();
  }

  function titleScore(value, base) {
    const text = normalizeTitle(value);
    if (text.length < 4) return -999;
    let score = base;
    if (text.length >= 12) score += 18;
    if (text.length >= 24) score += 10;
    if (text.length > 180) score -= 15;
    if (/(有限公司|公司|工厂|厂|商行|店铺|旗舰店|专营店|专卖店|企业|个体工商户)$/.test(text)) score -= 120;
    if (/源头厂家|实力商家|店铺|供应商|公司介绍/.test(text)) score -= 80;
    return score;
  }

  function decodeScriptString(value) {
    return cleanText(
      String(value || "")
        .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replace(/\\\//g, "/"),
      300,
    );
  }

  function extractJsonProductNames() {
    const result = [];
    let scanned = 0;
    const pattern = /["'](?:subject|offerTitle|productTitle|offerSubject|titleText)["']\s*:\s*["']([^"']{4,300})["']/gi;
    for (const script of document.scripts) {
      if (scanned >= 4_000_000 || result.length >= 30) break;
      const raw = script.textContent || "";
      if (!raw) continue;
      const text = raw.slice(0, 4_000_000 - scanned);
      scanned += text.length;
      for (const match of text.matchAll(pattern)) {
        const value = decodeScriptString(match[1]);
        if (value) result.push(value);
        if (result.length >= 30) break;
      }
    }
    return result;
  }

  function extractProductName() {
    const candidates = [];
    const push = (value, base, source) => {
      const text = normalizeTitle(value);
      if (!text) return;
      candidates.push({ text, score: titleScore(text, base), source });
    };

    extractJsonProductNames().forEach((value) => push(value, 160, "json"));
    push(document.title, 135, "document.title");
    push(document.querySelector('meta[property="og:title"]')?.getAttribute("content"), 130, "og:title");
    push(document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"), 125, "twitter:title");

    const selectors = [
      '[class*="offer-title"]',
      '[class*="product-title"]',
      '[class*="productTitle"]',
      '[class*="offerTitle"]',
      '[class*="subject"]',
      '[data-testid*="title"]',
      '[data-spm*="title"]',
    ];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        push(element.textContent, 120, selector);
      });
    });
    document.querySelectorAll("h1").forEach((element) => push(element.textContent, 105, "h1"));

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.text || "";
  }

  function structuredOptionName(value) {
    return cleanText(value, 100)
      .replace(/^[：:·•\s]+|[：:·•\s]+$/g, "")
      .replace(/\s*(?:库存|起批|已售|销量|价格|运费)[\s\S]*$/i, "")
      .trim();
  }

  function optionGroupName(value) {
    const text = cleanText(value, 100);
    const matched = text.match(GROUP_PATTERN)?.[1] || "";
    return structuredOptionName(matched);
  }

  function valueLooksValid(value, groupName) {
    const text = structuredOptionName(value);
    if (!text || text.length > 60) return false;
    if (optionGroupName(text) === groupName) return false;
    if (NOISE_PATTERN.test(text)) return false;
    if (!/[\u3400-\u9fffA-Za-z0-9]/.test(text)) return false;
    if (/^[+−-]?\s*\d+(?:\.\d+)?\s*$/.test(text)) return false;
    return true;
  }

  function collectValues(container, groupName, groupRect) {
    const selectors = [
      "li",
      "button",
      '[role="option"]',
      '[class*="sku-item"]',
      '[class*="skuItem"]',
      '[class*="prop-item"]',
      '[class*="propItem"]',
      '[class*="value-item"]',
      '[class*="spec-item"]',
      '[class*="sku"]',
      '[class*="prop"]',
      '[class*="value"]',
      '[class*="spec"]',
    ];
    const rows = [];
    const seen = new Set();
    container.querySelectorAll(selectors.join(",")).forEach((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return;
      const rect = element.getBoundingClientRect();
      if (rect.top < groupRect.bottom - 35 || rect.top > groupRect.bottom + 1000) return;
      if (rect.height > 160 || rect.width > 600) return;
      const raw = directText(element) || cleanText(element.textContent, 100);
      const sourceName = structuredOptionName(raw);
      if (!valueLooksValid(sourceName, groupName)) return;
      const key = sourceName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      let score = 0;
      if (/[\u3400-\u9fff]/.test(sourceName)) score += 12;
      if (sourceName.length <= 24) score += 8;
      if (element.matches('button,li,[role="option"]')) score += 10;
      if (/sku|prop|value|spec|select/i.test(cleanText(element.className, 240))) score += 8;
      score += Math.max(0, 12 - Math.min(12, Math.abs(rect.top - groupRect.bottom) / 60));
      rows.push({ sourceName, score, top: rect.top, left: rect.left });
    });
    rows.sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left);
    return rows.slice(0, 50);
  }

  function groupLabelCandidates() {
    const candidates = [];
    document.querySelectorAll('div,span,dt,label,h3,h4,[class*="sku"],[class*="prop"],[class*="spec"]').forEach((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return;
      const rect = element.getBoundingClientRect();
      if (rect.height > 120 || rect.width > 720) return;
      const direct = directText(element);
      const text = direct || cleanText(element.textContent, 100);
      const groupName = optionGroupName(text);
      if (!groupName) return;
      let score = 0;
      if (direct) score += 18;
      if (text === groupName) score += 24;
      if (text.startsWith(groupName)) score += 14;
      if (rect.height <= 60) score += 8;
      candidates.push({ element, groupName, score, top: rect.top });
    });
    return candidates.sort((a, b) => b.score - a.score || a.top - b.top);
  }

  function extractStructuredOptionGroups() {
    const groups = [];
    const seenGroups = new Set();
    for (const candidate of groupLabelCandidates()) {
      if (seenGroups.has(candidate.groupName)) continue;
      const groupRect = candidate.element.getBoundingClientRect();
      let best = [];
      let container = candidate.element.parentElement;
      for (let depth = 0; depth < 6 && container; depth += 1) {
        if (!(container instanceof HTMLElement)) break;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 1400 && rect.height <= 2200) {
          const values = collectValues(container, candidate.groupName, groupRect);
          if (values.length > best.length && values.length <= 50) best = values;
        }
        container = container.parentElement;
      }
      if (!best.length) continue;
      const ordered = [...best]
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((row, index) => ({
          id: `option_${index + 1}`,
          source_name: row.sourceName,
        }));
      seenGroups.add(candidate.groupName);
      groups.push({
        id: `group_${groups.length + 1}`,
        source_name: candidate.groupName,
        values: ordered,
      });
      if (groups.length >= 8) break;
    }
    return groups;
  }

  function extractSupplierOptions(bodyText) {
    const lines = cleanMultiline(bodyText, 20_000).split("\n");
    const result = [];
    const seen = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      if (!GROUP_PATTERN.test(lines[index])) continue;
      for (let offset = 0; offset <= 5; offset += 1) {
        const value = cleanText(lines[index + offset], 160);
        if (!value || NOISE_PATTERN.test(value)) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
        if (result.length >= 30) break;
      }
      if (result.length >= 30) break;
    }
    return result.join("\n").slice(0, 3000);
  }

  function safeReturnUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      const host = url.hostname.toLowerCase();
      const production = host === "commerce-os-ops-center.vercel.app";
      const preview = host.startsWith("commerce-os-ops-center-") && host.endsWith(".vercel.app");
      const local = host === "localhost" || host === "127.0.0.1";
      if (!production && !preview && !local) return "";
      if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
      if (url.pathname !== "/keyword-engine-elon-lab") return "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function base64Utf8(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function sourceUrlWithoutLabParams() {
    const url = new URL(location.href);
    url.searchParams.delete(COLLECT_PARAM);
    url.searchParams.delete(RETURN_PARAM);
    return url.toString();
  }

  async function collect() {
    const url = new URL(location.href);
    if (url.searchParams.get(COLLECT_PARAM) !== "1") return;
    const returnUrl = safeReturnUrl(url.searchParams.get(RETURN_PARAM));
    if (!returnUrl) {
      alert("Commerce OS Keyword Lab 복귀 주소가 올바르지 않습니다.");
      return;
    }

    url.searchParams.delete(COLLECT_PARAM);
    url.searchParams.delete(RETURN_PARAM);
    history.replaceState({}, document.title, url.pathname + url.search + url.hash);

    let productName = "";
    let supplierOptionGroups = [];
    let supplierOptions = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sleep(attempt === 0 ? 700 : 1200);
      productName = extractProductName();
      supplierOptionGroups = extractStructuredOptionGroups();
      supplierOptions = extractSupplierOptions(document.body?.innerText || "");
      if (productName && (supplierOptionGroups.length || supplierOptions || attempt >= 2)) break;
    }

    if (!productName) {
      alert("1688 실제 화면에서 중국 상품명을 찾지 못했습니다. 로그인 상태와 상품 페이지 로딩을 확인해 주세요.");
      return;
    }

    const body = cleanMultiline(document.body?.innerText || "", 5000);
    const payload = {
      schemaVersion: 1,
      source: "commerce-os-keyword-lab-collector",
      collectorVersion: chrome.runtime.getManifest().version,
      sourceUrl: sourceUrlWithoutLabParams(),
      productId: location.pathname.match(/\/offer\/(\d+)\.html/i)?.[1] || "",
      productName,
      supplierOptionGroups,
      supplierOptions,
      productAttributes: "",
      sourceProductInfo: [`商品标题: ${productName}`, supplierOptions, body].filter(Boolean).join("\n\n").slice(0, 6000),
      collectedAt: new Date().toISOString(),
    };

    const target = new URL(returnUrl);
    target.hash = new URLSearchParams({ [HASH_PARAM]: base64Utf8(payload) }).toString();
    location.replace(target.toString());
  }

  void collect();
})();
