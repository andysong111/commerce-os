(() => {
  const COLLECT_PARAM = "commerce_os_keyword_lab_collect";
  const RETURN_PARAM = "commerce_os_keyword_lab_return";
  const HASH_PARAM = "commerce_keyword_import";
  const ERROR_HASH_PARAM = "commerce_china_link_error";
  const RECOVERY_DELAY_MS = 8_500;
  const PAGE_NOISE = new Set([
    "登录",
    "注册",
    "首页",
    "消息",
    "收藏",
    "进货单",
    "我的阿里",
    "1688首页",
    "联系客服",
  ]);

  function cleanText(value, max = 8000) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function cleanMultiline(value, max = 6000) {
    return String(value || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 2 && !PAGE_NOISE.has(line))
      .filter(Boolean)
      .join("\n")
      .slice(0, max);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function safeReturnUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      const host = url.hostname.toLowerCase();
      const production = host === "commerce-os-ops-center.vercel.app";
      const preview =
        host.startsWith("commerce-os-ops-center-") && host.endsWith(".vercel.app");
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

  function sourceUrlWithoutControlParams(input) {
    const url = new URL(input.toString());
    url.searchParams.delete(COLLECT_PARAM);
    url.searchParams.delete(RETURN_PARAM);
    url.hash = "";
    return url.toString();
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
    if (text.length >= 10) score += 14;
    if (text.length >= 22) score += 8;
    if (text.length > 200) score -= 25;
    if (/^(?:1688|阿里巴巴|登录|首页|采购批发平台)$/i.test(text)) score -= 300;
    if (/(有限公司|公司|工厂|厂|商行|店铺|旗舰店|专营店|专卖店|企业)$/.test(text)) score -= 100;
    if (/源头厂家|实力商家|公司介绍|店铺/.test(text)) score -= 70;
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

  function extractProductTitle() {
    const candidates = [];
    const push = (value, base, source) => {
      const title = normalizeTitle(value);
      if (!title) return;
      candidates.push({ title, score: titleScore(title, base), source });
    };

    push(document.querySelector('meta[property="og:title"]')?.getAttribute("content"), 180, "og");
    push(document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"), 175, "twitter");
    push(document.title, 150, "document");
    document.querySelectorAll("h1").forEach((element) => push(element.textContent, 165, "h1"));
    for (const selector of [
      '[class*="offer-title"]',
      '[class*="product-title"]',
      '[class*="productTitle"]',
      '[class*="offerTitle"]',
      '[class*="subject"]',
      '[data-testid*="title"]',
      '[data-spm*="title"]',
    ]) {
      document.querySelectorAll(selector).forEach((element) =>
        push(element.textContent, 160, selector),
      );
    }

    let scanned = 0;
    const propertyPattern =
      /["'](?:subject|offerTitle|productTitle|offerSubject|titleText|name)["']\s*:\s*["']([^"']{4,300})["']/gi;
    for (const script of document.scripts) {
      if (scanned >= 5_000_000 || candidates.length >= 60) break;
      const raw = script.textContent || "";
      if (!raw) continue;
      const chunk = raw.slice(0, 5_000_000 - scanned);
      scanned += chunk.length;
      for (const match of chunk.matchAll(propertyPattern)) {
        push(decodeScriptString(match[1]), 190, "script");
        if (candidates.length >= 60) break;
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.score > 0 ? candidates[0].title : "";
  }

  function extractOptionText() {
    const pattern = /(颜色|顏色|色号|花色|规格|規格|尺寸|尺码|款式|样式|樣式|型号|型號|分类|分類)/i;
    const noise = /(库存|起批|已售|销量|价格|运费|发货|服务|¥|￥|元|个起|件起|箱起|按箱|每箱|现货|定制|收藏|对比|立即下单|加采购车|跨境铺货|代发|优惠|保障|客服)/i;
    const lines = cleanMultiline(document.body?.innerText || "", 20_000).split("\n");
    const output = [];
    const seen = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      if (!pattern.test(lines[index])) continue;
      for (let offset = 0; offset <= 5; offset += 1) {
        const value = cleanText(lines[index + offset], 160);
        const key = value.toLowerCase();
        if (!value || noise.test(value) || seen.has(key)) continue;
        seen.add(key);
        output.push(value);
        if (output.length >= 30) break;
      }
      if (output.length >= 30) break;
    }
    return output.join("\n").slice(0, 3000);
  }

  function deliver(returnUrl, hashParameter, payload) {
    const safe = safeReturnUrl(returnUrl);
    if (!safe) return false;
    const target = new URL(safe);
    target.hash = new URLSearchParams({
      [hashParameter]: encodeBase64Utf8(payload),
    }).toString();
    location.replace(target.toString());
    return true;
  }

  const initialUrl = new URL(location.href);
  if (initialUrl.searchParams.get(COLLECT_PARAM) !== "1") return;
  const returnUrl = initialUrl.searchParams.get(RETURN_PARAM) || "";
  const sourceUrl = sourceUrlWithoutControlParams(initialUrl);
  const originalAlert = window.alert.bind(window);
  window.alert = (message) => {
    const text = cleanText(message, 500);
    if (
      /1688 실제 화면에서 중국 상품명을 찾지 못했습니다|Commerce OS Keyword Lab 복귀 주소가 올바르지 않습니다/.test(
        text,
      )
    ) {
      return;
    }
    originalAlert(message);
  };

  const timer = window.setTimeout(() => {
    const productName = extractProductTitle();
    const supplierOptions = extractOptionText();
    const body = cleanMultiline(document.body?.innerText || "", 5000);
    if (productName) {
      deliver(returnUrl, HASH_PARAM, {
        schemaVersion: 1,
        source: "commerce-os-keyword-lab-collector-v013-recovery",
        collectorVersion: chrome.runtime.getManifest().version,
        sourceUrl,
        productId: new URL(sourceUrl).pathname.match(/\/offer\/(\d+)\.html/i)?.[1] || "",
        productName,
        supplierOptionGroups: [],
        supplierOptions,
        productAttributes: "",
        sourceProductInfo: [
          `商品标题: ${productName}`,
          supplierOptions,
          body,
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 6000),
        collectedAt: new Date().toISOString(),
      });
      return;
    }

    deliver(returnUrl, ERROR_HASH_PARAM, {
      schemaVersion: 1,
      source: "commerce-os-keyword-lab-collector-v013-recovery",
      collectorVersion: chrome.runtime.getManifest().version,
      mode: "keyword_collect",
      sourceUrl,
      finalUrl: location.href,
      status: "temporary_error",
      errorCode: "product_title_unreadable",
      errorMessage:
        "로그인 여부와 별개로 1688 동적 화면에서 상품명을 읽지 못했습니다. 현재 실행은 중단하고 링크를 일시 오류로 보류했습니다.",
      detectedText: cleanText(document.title || document.body?.innerText, 500),
      checkedAt: new Date().toISOString(),
    });
  }, RECOVERY_DELAY_MS);

  window.addEventListener(
    "pagehide",
    () => {
      window.clearTimeout(timer);
      window.alert = originalAlert;
    },
    { once: true },
  );
})();
