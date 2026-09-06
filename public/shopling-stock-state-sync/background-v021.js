importScripts("background-v020.js");

(() => {
  const OVERLAY_VERSION = "0.2.1";
  const WORKER_FILE = "content-shopling-v018.js";
  const A6_MARKER_FILE = "a6-role-marker-v016.js";
  const RELOAD_WAIT_MS = 15_000;
  const ROLE_WAIT_MS = 12_000;
  const POLL_MS = 250;

  const baseStartV020 = start;
  const baseDispatchToTargetV020 = dispatchToTarget;

  const sleepV021 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function executeAllFramesV021(tabId, func, args = []) {
    try {
      return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
    } catch {
      return [];
    }
  }

  async function identifyFramesV021(tabId) {
    return executeAllFramesV021(tabId, () => {
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

  exactRoleTargetInTab = async function exactRoleTargetInTabV021(tab, stage) {
    if (!Number.isInteger(tab?.id)) return null;
    const expected = expectedRole(stage);
    if (!expected) return null;
    const frames = await identifyFramesV021(tab.id);
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
        detector: "price-engine-all-frames-v021",
      },
      role: expected,
    };
  };

  findExactRoleTarget = async function findExactRoleTargetV021(stage) {
    for (const tab of await shoplingTabs()) {
      const target = await exactRoleTargetInTab(tab, stage);
      if (target) return target;
    }
    return null;
  };

  async function ensureWorkerV021(target, stage) {
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
      await sleepV021(150);
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

  dispatchToTarget = async function dispatchToTargetV021(active, target) {
    if (!active || !target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const workerReady = await ensureWorkerV021(target, active.stage);
    if (!workerReady) return false;
    return baseDispatchToTargetV020(active, target);
  };

  async function waitTabCompleteV021(tabId) {
    const deadline = Date.now() + RELOAD_WAIT_MS;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return false;
      if (tab.status === "complete") return true;
      await sleepV021(POLL_MS);
    }
    return false;
  }

  async function waitRequiredRolesV021(job) {
    const deadline = Date.now() + ROLE_WAIT_MS;
    let last = null;
    while (Date.now() < deadline) {
      last = await preflightWorkTabs(job);
      if (last?.ok) return last;
      await sleepV021(POLL_MS);
    }
    return last || { ok: false, missing: requiredStages(job.productKind).map(requiredTabLabel) };
  }

  async function refreshFixedWorkTabsV021(job) {
    const initial = await preflightWorkTabs(job);
    if (!initial.ok) return initial;
    const tabIds = [...new Set(Object.values(initial.targets || {}).map((target) => target?.tabId).filter(Number.isInteger))];
    for (const tabId of tabIds) {
      await chrome.tabs.reload(tabId).catch(() => null);
    }
    for (const tabId of tabIds) {
      const complete = await waitTabCompleteV021(tabId);
      if (!complete) {
        return {
          ok: false,
          code: "SHOPLING_WORK_TAB_RELOAD_TIMEOUT",
          message: "Shopling 고정 작업탭 새로고침이 완료되지 않았습니다. A4/A6/A21 탭을 확인한 뒤 다시 시도하세요.",
        };
      }
    }
    return waitRequiredRolesV021(job);
  }

  start = async function startV021(input) {
    const normalized = validJob(input);
    if (!normalized.ok) return normalized;
    const existing = await loadActive();
    if (existing?.status === "RUNNING") return baseStartV020(input);

    const refreshed = await refreshFixedWorkTabsV021(normalized.job);
    if (!refreshed?.ok) {
      return {
        ok: false,
        code: refreshed?.code || "SHOPLING_REQUIRED_WORK_TAB_MISSING",
        message: refreshed?.message || `Shopling 고정 작업탭 준비에 실패했습니다: ${(refreshed?.missing || []).join(", ")}`,
        missing: refreshed?.missing || [],
      };
    }

    const result = await baseStartV020(input);
    if (result?.ok) {
      const active = await loadActive();
      if (active) {
        active.engine = "PRICE_EXTENSION_STYLE_V021";
        active.workerPolicy = "RELOAD_FIXED_TABS_THEN_ALL_FRAME_SCAN_AND_DYNAMIC_INJECTION";
        await saveActive(active);
      }
    }
    return result;
  };
})();
