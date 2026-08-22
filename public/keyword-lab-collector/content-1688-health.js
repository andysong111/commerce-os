(() => {
  const COLLECT_PARAM = "commerce_os_keyword_lab_collect";
  const RETURN_PARAM = "commerce_os_keyword_lab_return";
  const CONTEXT_HASH_PARAM = "commerce_os_keyword_lab_context";
  const ERROR_HASH_PARAM = "commerce_china_link_error";
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
    const mode = cleanText(value.mode, 40);
    if (mode !== "keyword_collect" && mode !== "link_audit") return null;
    return {
      mode,
      returnUrl: cleanText(value.returnUrl, 1500),
      sourceUrl: cleanText(value.sourceUrl, 4000),
      itemId: cleanText(value.itemId, 180),
      trackerRowNumber: Number(value.trackerRowNumber) || null,
      modelNumber: cleanText(value.modelNumber, 120),
      productName: cleanText(value.productName, 300),
      requestedAt: cleanText(value.requestedAt, 80),
    };
  }

  function contextFromWindowName() {
    const raw = String(window.name || "");
    if (!raw.startsWith(WINDOW_CONTEXT_PREFIX)) return null;
    try {
      return safeContext(decodeBase64Utf8(raw.slice(WINDOW_CONTEXT_PREFIX.length)));
    } catch {
      return null;
    }
  }

  function contextFromHash() {
    try {
      const encoded = new URLSearchParams(location.hash.replace(/^#/, "")).get(
        CONTEXT_HASH_PARAM,
      );
      return encoded ? safeContext(decodeBase64Utf8(encoded)) : null;
    } catch {
      return null;
    }
  }

  function contextFromQuery() {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get(COLLECT_PARAM) !== "1") return null;
      return safeContext({
        mode: "keyword_collect",
        returnUrl: url.searchParams.get(RETURN_PARAM) || "",
        sourceUrl: sourceUrlWithoutControlParams(url),
        requestedAt: new Date().toISOString(),
      });
    } catch {
      return null;
    }
  }

  function readContext() {
    return contextFromWindowName() || contextFromHash() || contextFromQuery();
  }

  function safeReturnUrl(raw, mode) {
    try {
      const url = new URL(String(raw || ""));
      const host = url.hostname.toLowerCase();
      const production = host === "commerce-os-ops-center.vercel.app";
      const preview = host.startsWith("commerce-os-ops-center-") && host.endsWith(".vercel.app");
      const local = host === "localhost" || host === "127.0.0.1";
      if (!production && !preview && !local) return "";
      if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
      const allowedPath =
        mode === "link_audit"
          ? url.pathname === "/china-link-audit-callback"
          : url.pathname === "/keyword-engine-elon-lab";
      if (!allowedPath) return "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function sourceUrlWithoutControlParams(input = new URL(location.href)) {
    const url = new URL(input.toString());
    url.searchParams.delete(COLLECT_PARAM);
    url.searchParams.delete(RETURN_PARAM);
    url.hash = "";
    return url.toString();
  }

  function pageSnapshot() {
    const body = cleanText(document.body?.innerText || "", 12000);
    const title = cleanText(document.title, 500);
    const combined = `${title}\n${body}`;
    const pathname = location.pathname.toLowerCase();
    const hostname = location.hostname.toLowerCase();

    const permanentPatterns = [
      {
        code: "not_found",
        message: "1688 페이지를 찾지 못했습니다.",
        pattern: /error\s*404|抱歉[^\n]{0,30}未找到页面|未找到页面|页面不存在|找不到页面|wrongpage/i,
      },
      {
        code: "off_shelf",
        message: "1688 상품이 단종·삭제·판매중지 상태입니다.",
        pattern: /商品已下架|该商品已下架|商品下架|商品已失效|商品不存在|宝贝已下架|offer\s*(?:not found|unavailable)/i,
      },
      {
        code: "supplier_closed",
        message: "1688 판매처·공장·상점이 폐업 또는 종료된 상태입니다.",
        pattern: /店铺已关闭|店铺不存在|店铺已注销|商家已关闭|企业已注销|公司已注销|工厂已关闭|供应商已关闭/i,
      },
    ];
    if (/\/shtml\/static\/wrongpage\.html/i.test(pathname)) {
      return {
        status: "link_error",
        errorCode: "not_found",
        errorMessage: "1688 페이지가 Error 404 화면으로 이동했습니다.",
        detectedText: title || body.slice(0, 300),
      };
    }
    for (const row of permanentPatterns) {
      const matched = combined.match(row.pattern);
      if (matched) {
        return {
          status: "link_error",
          errorCode: row.code,
          errorMessage: row.message,
          detectedText: cleanText(matched[0], 300),
        };
      }
    }

    const temporaryPatterns = [
      {
        code: "access_blocked",
        message: "1688 보안검증·접속제한 화면입니다. 링크 오류로 확정하지 않았습니다.",
        pattern: /访问过于频繁|安全验证|滑块验证|请完成验证|异常访问|验证码|系统繁忙|网络拥堵/i,
      },
      {
        code: "login_required",
        message: "1688 로그인 화면으로 이동했습니다. 링크 오류로 확정하지 않았습니다.",
        pattern: /登录后(?:查看|访问|采购)|请先登录|账号登录|扫码登录/i,
      },
    ];
    if (/login\.|passport\./i.test(hostname)) {
      return {
        status: "temporary_error",
        errorCode: "login_required",
        errorMessage: temporaryPatterns[1].message,
        detectedText: title || body.slice(0, 300),
      };
    }
    for (const row of temporaryPatterns) {
      const matched = combined.match(row.pattern);
      if (matched) {
        return {
          status: "temporary_error",
          errorCode: row.code,
          errorMessage: row.message,
          detectedText: cleanText(matched[0], 300),
        };
      }
    }

    const offerPath = /\/offer\/\d+\.html/i.test(pathname);
    const titleSignals = [
      document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
      document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
      document.querySelector("h1")?.textContent,
      title,
    ]
      .map((value) => cleanText(value, 500))
      .filter((value) => value.length >= 4)
      .filter((value) => !/^(?:1688|阿里巴巴|登录|首页)/i.test(value));

    return {
      status: offerPath && titleSignals.length ? "ok" : "unknown",
      errorCode: "",
      errorMessage: "",
      detectedText: titleSignals[0] || title || body.slice(0, 300),
    };
  }

  function clearControlAddress() {
    try {
      const url = new URL(location.href);
      url.searchParams.delete(COLLECT_PARAM);
      url.searchParams.delete(RETURN_PARAM);
      url.hash = "";
      history.replaceState({}, document.title, url.pathname + url.search);
    } catch {
      // Navigation will still continue even if address cleanup is unavailable.
    }
  }

  function clearOnlyContextHash() {
    try {
      const url = new URL(location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      if (!hash.has(CONTEXT_HASH_PARAM)) return;
      hash.delete(CONTEXT_HASH_PARAM);
      url.hash = hash.toString();
      history.replaceState(
        {},
        document.title,
        `${url.pathname}${url.search}${url.hash ? `#${url.hash.replace(/^#/, "")}` : ""}`,
      );
    } catch {
      // The legacy collector can still proceed with the original query parameters.
    }
  }

  function deliver(context, payload, hashParameter) {
    const returnUrl = safeReturnUrl(context.returnUrl, context.mode);
    if (!returnUrl) return false;
    const target = new URL(returnUrl);
    target.hash = new URLSearchParams({
      [hashParameter]: encodeBase64Utf8(payload),
    }).toString();
    window.name = "";
    location.replace(target.toString());
    return true;
  }

  async function runAudit(context) {
    let result = pageSnapshot();
    for (let attempt = 0; attempt < 5 && result.status === "unknown"; attempt += 1) {
      await sleep(attempt === 0 ? 500 : 1000);
      result = pageSnapshot();
    }
    if (result.status === "unknown") {
      result = {
        status: "temporary_error",
        errorCode: "empty_or_unreadable",
        errorMessage:
          "1688 화면에서 상품 또는 명확한 오류 문구를 읽지 못했습니다. 일시적 로딩·로그인 문제로 분류했습니다.",
        detectedText: cleanText(document.title || document.body?.innerText, 300),
      };
    }
    deliver(
      context,
      {
        schemaVersion: 1,
        source: "commerce-os-china-link-health-collector",
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
      },
      AUDIT_RESULT_HASH_PARAM,
    );
  }

  function runKeywordErrorGuard(context) {
    const result = pageSnapshot();
    if (result.status === "ok" || result.status === "unknown") {
      clearOnlyContextHash();
      return;
    }
    clearControlAddress();
    deliver(
      context,
      {
        schemaVersion: 1,
        source: "commerce-os-keyword-lab-link-health",
        collectorVersion: chrome.runtime.getManifest().version,
        mode: "keyword_collect",
        sourceUrl: context.sourceUrl,
        finalUrl: location.href,
        status: result.status,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        detectedText: result.detectedText,
        checkedAt: new Date().toISOString(),
      },
      ERROR_HASH_PARAM,
    );
  }

  const context = readContext();
  if (!context) return;
  if (context.mode === "link_audit") {
    void runAudit(context);
    return;
  }
  runKeywordErrorGuard(context);
})();
