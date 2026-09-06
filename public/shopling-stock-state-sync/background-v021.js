importScripts("background-v020.js");

(() => {
  const OVERLAY_VERSION = "0.2.2";
  const WORKER_FILE = "content-shopling-v018.js";
  const A6_MARKER_FILE = "a6-role-marker-v016.js";

  const baseStartV020 = start;
  const baseDispatchToTargetV020 = dispatchToTarget;
  const sleepV022 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function executeAllFramesV022(tabId, func, args = []) {
    try {
      return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
    } catch {
      return [];
    }
  }

  async function identifyFramesV022(tabId) {
    return executeAllFramesV022(tabId, () => {
      const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
      const text = norm(document.body?.innerText || document.body?.textContent || "");
      const href = String(location.href || "");
      const selectHas = (label) => [...document.querySelectorAll("select")].some((select) =>
        [...select.options].some((option) => norm(option.textContent).includes(label)),
      );
      let role = "OTHER";
      if (/상품수정\s*송신/i.test(text) && (/상품판매상태송신/i.test(text) || /옵션송신|상품옵션(?:송신|전송)/i.test(text))) {
        role = "A21_POPUP";
      } else if (/쇼핑몰상품수정/i.test(text) && /상품\s*수정전송/i.test(text) && /검색항목/i.test(text)) {
        role = "A21_LIST";
      } else if (/옵션대량수정/i.test(text) && /검색항목/i.test(text) && selectHas("옵션자체관리코드")) {
        role = "A6";
      } else if (/상품조회수정/i.test(text) && /검색항목/i.test(text) && !/goods_mallMdfy_trsmt\.phtml/i.test(href)) {
        role = "A4";
      } else if (/성공건수|실패건수|성공여부|수정\s*전송\s*결과|상품\s*옵션\s*수정\s*전송/i.test(text)) {
        role = "RESULT";
      }
      return {
        role,
        href,
        title: String(document.title || ""),
        textSample: text.slice(0, 700),
        readyState: String(document.readyState || ""),
      };
    });
  }

  exactRoleTargetInTab = async function exactRoleTargetInTabV022(tab, stage) {
    if (!Number.isInteger(tab?.id)) return null;
    const expected = expectedRole(stage);
    if (!expected) return null;
    const frames = await identifyFramesV022(tab.id);
    const exact = (frames || []).find((entry) => entry?.result?.role === expected);
    if (!exact || !Number.isInteger(exact.frameId)) return null;
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      frameId: exact.frameId,
      page: {
        role: expected,
        href: exact.result?.href || String(tab.url || ""),
        title: exact.result?.title || String(tab.title || ""),
        top: exact.frameId === 0,
        canNavigate: false,
        detector: "price-engine-all-frames-v022-no-reload",
      },
      role: expected,
    };
  };

  findExactRoleTarget = async function findExactRoleTargetV022(stage) {
    for (const tab of await shoplingTabs()) {
      const target = await exactRoleTargetInTab(tab, stage);
      if (target) return target;
    }
    return null;
  };

  async function ensureWorkerV022(target, stage) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    let probe = await chrome.tabs.sendMessage(
      target.tabId,
      { type: "STOCK_SYNC_PROBE", stage, expectedRole: expectedRole(stage), version: OVERLAY_VERSION },
      { frameId: target.frameId },
    ).catch(() => null);
    if (probe?.ok) return true;

    try {
      if (stage === "A6") {
        await chrome.scripting.executeScript({
          target: { tabId: target.tabId, frameIds: [target.frameId] },
          files: [A6_MARKER_FILE],
        }).catch(() => null);
      }
      await chrome.scripting.executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        files: [WORKER_FILE],
      });
      await sleepV022(180);
    } catch {
      return false;
    }

    probe = await chrome.tabs.sendMessage(
      target.tabId,
      { type: "STOCK_SYNC_PROBE", stage, expectedRole: expectedRole(stage), version: OVERLAY_VERSION },
      { frameId: target.frameId },
    ).catch(() => null);
    return Boolean(probe?.ok);
  }

  dispatchToTarget = async function dispatchToTargetV022(active, target) {
    if (!active || !target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const workerReady = await ensureWorkerV022(target, active.stage);
    if (!workerReady) return false;
    return baseDispatchToTargetV020(active, target);
  };

  start = async function startV022(input) {
    const normalized = validJob(input);
    if (!normalized.ok) return normalized;
    const existing = await loadActive();
    if (existing?.status === "RUNNING") return baseStartV020(input);

    const preflight = await preflightWorkTabs(normalized.job);
    if (!preflight?.ok) {
      return {
        ok: false,
        code: preflight?.code || "SHOPLING_REQUIRED_WORK_TAB_MISSING",
        message: preflight?.message || `Shopling 고정 작업탭 준비에 실패했습니다: ${(preflight?.missing || []).join(", ")}`,
        missing: preflight?.missing || [],
      };
    }

    const result = await baseStartV020(input);
    if (result?.ok) {
      const active = await loadActive();
      if (active) {
        active.engine = "PRICE_EXTENSION_STYLE_V022";
        active.workerPolicy = "PRESERVE_FIXED_TABS_ALL_FRAME_SCAN_AND_DYNAMIC_INJECTION";
        await saveActive(active);
      }
    }
    return result;
  };
})();
