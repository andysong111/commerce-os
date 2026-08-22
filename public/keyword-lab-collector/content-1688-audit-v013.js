(() => {
  const CONTEXT_HASH_PARAM = "commerce_os_keyword_lab_context";
  const AUDIT_RESULT_HASH_PARAM = "commerce_china_link_audit";
  const WINDOW_CONTEXT_PREFIX = "commerce-os-1688-context:";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cleanText(value, max = 8000) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
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

  function decodeBase64Utf8(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function safeContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (cleanText(value.mode, 40) !== "link_audit") return null;
    return {
      mode: "link_audit",
      returnUrl: cleanText(value.returnUrl, 1500),
      sourceUrl: cleanText(value.sourceUrl, 4000),
      itemId: cleanText(value.itemId, 180),
      trackerRowNumber: Number(value.trackerRowNumber) || null,
      modelNumber: cleanText(value.modelNumber, 120),
      productName: cleanText(value.productName, 300),
      requestedAt: cleanText(value.requestedAt, 80),
    };
  }

  function readContext() {
    const windowName = String(window.name || "");
    if (windowName.startsWith(WINDOW_CONTEXT_PREFIX)) {
      try {
        const parsed = safeContext(
          decodeBase64Utf8(windowName.slice(WINDOW_CONTEXT_PREFIX.length)),
        );
        if (parsed) return parsed;
      } catch {
        // Continue with hash fallback.
      }
    }
    try {
      const encoded = new URLSearchParams(location.hash.replace(/^#/, "")).get(
        CONTEXT_HASH_PARAM,
      );
      return encoded ? safeContext(decodeBase64Utf8(encoded)) : null;
    } catch {
      return null;
    }
  }

  function clearCapturedContext() {
    window.name = "";
    try {
      const url = new URL(location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      hash.delete(CONTEXT_HASH_PARAM);
      url.hash = hash.toString();
      history.replaceState(
        {},
        document.title,
        `${url.pathname}${url.search}${url.hash ? `#${url.hash.replace(/^#/, "")}` : ""}`,
      );
    } catch {
      // Captured context in memory is enough.
    }
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
      if (url.pathname !== "/china-link-audit-callback") return "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
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

  function snapshot() {
    const title = cleanText(document.title, 500);
    const body = cleanText(document.body?.innerText || "", 16_000);
    const combined = `${title}\n${body}`;
    const pathname = location.pathname.toLowerCase();
    const hostname = location.hostname.toLowerCase();

    if (/\/shtml\/static\/wrongpage\.html/i.test(pathname)) {
      return {
        status: "link_error",
        errorCode: "not_found",
        errorMessage: "1688 페이지가 Error 404 화면으로 이동했습니다.",
        detectedText: title || body.slice(0, 300),
      };
    }

    const permanent = [
      ["not_found", "1688 페이지를 찾지 못했습니다.", /error\s*404|抱歉[^\n]{0,30}未找到页面|未找到页面|页面不存在|找不到页面|wrongpage/i],
      ["off_shelf", "1688 상품이 단종·삭제·판매중지 상태입니다.", /商品已下架|该商品已下架|商品下架|商品已失效|商品不存在|宝贝已下架|offer\s*(?:not found|unavailable)/i],
      ["supplier_closed", "1688 판매처·공장·상점이 폐업 또는 종료된 상태입니다.", /店铺已关闭|店铺不存在|店铺已注销|商家已关闭|企业已注销|公司已注销|工厂已关闭|供应商已关闭/i],
    ];
    for (const [errorCode, errorMessage, pattern] of permanent) {
      const matched = combined.match(pattern);
      if (matched) {
        return {
          status: "link_error",
          errorCode,
          errorMessage,
          detectedText: cleanText(matched[0], 300),
        };
      }
    }

    const temporary = [
      ["access_blocked", "1688 보안검증·접속제한 화면입니다. 링크 오류로 확정하지 않았습니다.", /访问过于频繁|安全验证|滑块验证|请完成验证|异常访问|验证码|系统繁忙|网络拥堵/i],
      ["login_required", "1688 로그인 화면으로 이동했습니다. 링크 오류로 확정하지 않았습니다.", /登录后(?:查看|访问|采购)|请先登录|账号登录|扫码登录/i],
    ];
    if (/login\.|passport\./i.test(hostname)) {
      return {
        status: "temporary_error",
        errorCode: "login_required",
        errorMessage: temporary[1][1],
        detectedText: title || body.slice(0, 300),
      };
    }
    for (const [errorCode, errorMessage, pattern] of temporary) {
      const matched = combined.match(pattern);
      if (matched) {
        return {
          status: "temporary_error",
          errorCode,
          errorMessage,
          detectedText: cleanText(matched[0], 300),
        };
      }
    }

    const productTitle = extractProductTitle();
    if (/\/offer\/\d+\.html/i.test(pathname) && productTitle) {
      return {
        status: "ok",
        errorCode: "",
        errorMessage: "",
        detectedText: productTitle,
      };
    }
    return {
      status: "unknown",
      errorCode: "",
      errorMessage: "",
      detectedText: productTitle || title || body.slice(0, 300),
    };
  }

  function deliver(context, result) {
    const returnUrl = safeReturnUrl(context.returnUrl);
    if (!returnUrl) return;
    const target = new URL(returnUrl);
    target.hash = new URLSearchParams({
      [AUDIT_RESULT_HASH_PARAM]: encodeBase64Utf8({
        schemaVersion: 1,
        source: "commerce-os-china-link-health-collector-v013",
        collectorVersion: chrome.runtime.getManifest().version,
        mode: "link_audit",
        itemId: context.itemId,
        trackerRowNumber: context.trackerRowNumber,
        modelNumber: context.modelNumber,
        productName: context.productName,
        url: context.sourceUrl,
        finalUrl: location.href,
        status: result.status,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        detectedText: result.detectedText,
        checkedAt: new Date().toISOString(),
      }),
    }).toString();
    location.replace(target.toString());
  }

  async function run(context) {
    const waits = [350, 700, 1_000, 1_200, 1_500, 1_800];
    let result = snapshot();
    for (const wait of waits) {
      if (result.status !== "unknown") break;
      await sleep(wait);
      result = snapshot();
    }
    if (result.status === "unknown") {
      result = {
        status: "temporary_error",
        errorCode: "empty_or_unreadable",
        errorMessage:
          "1688 화면에서 상품명이나 명확한 오류 문구를 읽지 못했습니다. 일시적 로딩·접속 문제로 분류했습니다.",
        detectedText: result.detectedText,
      };
    }
    deliver(context, result);
  }

  const context = readContext();
  if (!context) return;
  clearCapturedContext();
  void run(context);
})();
