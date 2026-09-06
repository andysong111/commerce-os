importScripts("background-v020.js");

// v0.3.0: reuse the proven A21 price engine's operating pattern:
// create isolated worker windows, inspect every frame from background, inject the worker
// only into the exact frame, and retain diagnostics instead of relying on page self-identification.
(() => {
  const VERSION_V030 = "0.3.0";
  const WORKSPACE_KEY = "commerceStockWorkspaceV030";
  const WORKER_FILE = "content-shopling-v030.js";
  const labels = { A4: "상품조회수정", A6: "옵션대량수정", A21_LIST: "쇼핑몰상품수정" };
  const numbers = { A4: "4", A6: "6", A21_LIST: "21" };
  let workspace = null;

  const compactV030 = (v) => String(v ?? "").normalize("NFKC").replace(/\s+/g, "");

  async function loadWorkspaceV030() {
    if (!workspace) workspace = (await chrome.storage.local.get(WORKSPACE_KEY))[WORKSPACE_KEY] || null;
    return workspace;
  }
  async function saveWorkspaceV030(value) {
    workspace = value;
    await chrome.storage.local.set({ [WORKSPACE_KEY]: value });
  }

  async function scanFramesV030(tabId) {
    return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
      const norm = (v) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
      const compact = (v) => norm(v).replace(/\s+/g, "");
      const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
      const path = String(location.pathname || "").toLowerCase();
      const selects = [...document.querySelectorAll("select")];
      const optionLabels = selects.flatMap((s) => [...s.options].map((o) => compact(o.textContent))).filter(Boolean);
      const hasExact = (label) => optionLabels.includes(compact(label));
      let role = "OTHER";
      if (/상품(?:옵션)?\s*(?:수정\s*)?전송이\s*완료되었습니다|처리중입니다|성공건수\s*[:：]/i.test(text)) role = "RESULT";
      else if (path === "/prodlinkage/goods_mallmdfy_trsmt.phtml" || (/상품수정\s*송신/i.test(text) && /상품판매상태송신|옵션송신/i.test(text))) role = "A21_POPUP";
      else if (hasExact("옵션자체관리코드")) role = "A6";
      else if (hasExact("샵플링상품코드") && (/쇼핑몰상품수정/i.test(text) || /상품\s*수정전송/i.test(text))) role = "A21_LIST";
      else if (/상품조회수정/i.test(text) && /검색항목/i.test(text)) role = "A4";
      const authenticated = /로그아웃/.test(text) || [...document.querySelectorAll("a[href]")].some((a) => /logout/i.test(String(a.getAttribute("href") || "")));
      return {
        role, authenticated, href: String(location.href || ""), title: String(document.title || ""), ready: String(document.readyState || ""),
        hasOptionBarcode: hasExact("옵션자체관리코드"), hasGoodsKey: hasExact("샵플링상품코드"),
        optionLabels: optionLabels.slice(0, 80), textSample: text.slice(0, 500),
      };
    }}).catch(() => []);
  }

  async function targetInTabV030(tab, stage) {
    if (!Number.isInteger(tab?.id)) return null;
    const rows = await scanFramesV030(tab.id);
    const expected = expectedRole(stage);
    const row = rows.find((r) => r.result?.role === expected);
    if (!row) return null;
    return { tabId: tab.id, windowId: tab.windowId, frameId: row.frameId, role: expected, page: { role: expected, href: row.result.href, title: row.result.title, canNavigate: false }, diagnostic: row.result };
  }

  async function ensureWorkerV030(target, stage) {
    if (!target) return false;
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs.sendMessage(target.tabId, { type: "STOCK_SYNC_PROBE", stage, expectedRole: expectedRole(stage), version: VERSION_V030 }, options).catch(() => null);
    if (probe?.ok && probe.page?.role === expectedRole(stage)) return true;
    await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [target.frameId] }, files: [WORKER_FILE] }).catch(() => null);
    await sleep(120);
    probe = await chrome.tabs.sendMessage(target.tabId, { type: "STOCK_SYNC_PROBE", stage, expectedRole: expectedRole(stage), version: VERSION_V030 }, options).catch(() => null);
    return Boolean(probe?.ok && probe.page?.role === expectedRole(stage));
  }

  async function chooseSourceV030() {
    const tabs = await shoplingTabs();
    for (const tab of tabs) {
      if (/goods_mallMdfy_trsmt|result/i.test(String(tab.url || ""))) continue;
      const rows = await scanFramesV030(tab.id);
      if (rows.some((r) => r.result?.authenticated)) return tab;
    }
    return null;
  }

  async function clickExactMenuV030(tabId, stage) {
    const rows = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", func: (label, number) => {
      const clean = (v) => String(v || "").normalize("NFKC").replace(/\s/g, "");
      const pattern = new RegExp(`(?:\\[?A?${number}\\]?[:.\\-]?\\s*)?${label}`);
      const nodes = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"],[onclick],li,td,span,div')];
      const matches = nodes.filter((node) => {
        const value = clean(node instanceof HTMLInputElement ? `${node.value || ""} ${node.title || ""}` : `${node.textContent || ""} ${node.getAttribute?.("title") || ""}`);
        return value && value.length < 100 && pattern.test(value);
      });
      matches.sort((a,b) => Number(!(a.matches("a,[onclick]"))) - Number(!(b.matches("a,[onclick]"))) || clean(a.textContent || a.value).length - clean(b.textContent || b.value).length);
      const target = matches[0]?.closest?.("a,[onclick]") || matches[0];
      if (!target) return false;
      try { target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, view: window })); } catch {}
      try { target.click(); return true; } catch { return false; }
    }, args: [labels[stage], numbers[stage]] }).catch(() => []);
    return rows.some((r) => r.result === true);
  }

  async function openWorkerV030(source, stage, job) {
    const created = await chrome.windows.create({ url: source.url || SHOPLING_ORIGIN, type: "popup", width: 1420, height: 900, focused: false });
    const tab = created.tabs?.[0];
    if (!Number.isInteger(tab?.id)) throw new Error(`${labels[stage]} 작업창을 만들지 못했습니다.`);
    const ws = await loadWorkspaceV030();
    ws.targets[stage] = { tabId: tab.id, windowId: created.id, owned: true, createdAt: Date.now() };
    await saveWorkspaceV030(ws);
    const deadline = Date.now() + 45_000;
    let lastDiag = [];
    while (Date.now() < deadline) {
      const target = await targetInTabV030({ ...tab, windowId: created.id }, stage);
      if (target) return target;
      lastDiag = (await scanFramesV030(tab.id)).map((r) => ({ frameId: r.frameId, ...(r.result || {}) }));
      await clickExactMenuV030(tab.id, stage);
      await sleep(500);
    }
    throw new Error(`${labels[stage]} 자동진입 실패 · frame 진단=${JSON.stringify(lastDiag.slice(0,8))}`);
  }

  findExactRoleTarget = async function findExactRoleTargetV030(stage) {
    const ws = await loadWorkspaceV030();
    const saved = ws?.targets?.[stage];
    if (saved) {
      const tab = await chrome.tabs.get(saved.tabId).catch(() => null);
      const target = tab && await targetInTabV030(tab, stage);
      if (target) return target;
    }
    for (const tab of await shoplingTabs()) {
      if (ws?.sourceTabId === tab.id) continue;
      const target = await targetInTabV030(tab, stage);
      if (target) return target;
    }
    return null;
  };

  preflightWorkTabs = async function preflightWorkTabsV030(job) {
    const source = await chooseSourceV030();
    if (!source) return { ok: false, code: "SHOPLING_LOGIN_REQUIRED", message: "로그인 완료된 Shopling 관리자 메인 탭 1개를 열어두세요." };
    const executionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ws = { executionId, sourceTabId: source.id, sourceUrl: source.url, targets: {}, baselineTabIds: (await shoplingTabs()).map((t) => t.id) };
    await saveWorkspaceV030(ws);
    const targets = {};
    try {
      for (const stage of requiredStages(job.productKind)) {
        const target = await openWorkerV030(source, stage, job);
        if (!await ensureWorkerV030(target, stage)) {
          throw new Error(`${labels[stage]} 정확 frame은 찾았지만 worker 연결에 실패했습니다. 진단=${JSON.stringify(target.diagnostic || {})}`);
        }
        targets[stage] = target;
        ws.targets[stage] = { ...target, owned: true };
        await saveWorkspaceV030(ws);
      }
      for (const stage of requiredStages(job.productKind)) {
        const t = targets[stage];
        const result = await chrome.scripting.executeScript({ target: { tabId: t.tabId, frameIds: [t.frameId] }, func: () => {
          const setter = (el, value) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); if (d?.set) d.set.call(el, value); else el.value = value; el.dispatchEvent(new Event("input", { bubbles:true })); el.dispatchEvent(new Event("change", { bubbles:true })); return String(el.value) === String(value); };
          return globalThis.CommerceStockSearchV023?.applyPeriod?.(document, setter) || { ok:false, code:"SEARCH_POLICY_MISSING", message:"검색기간 정책이 worker에 없습니다." };
        }}).catch(() => []);
        const date = result[0]?.result;
        if (!date?.ok) return { ok:false, code: date?.code || "SEARCH_DATE_VERIFY_FAILED", message: `${labels[stage]}: ${date?.message || "검색기간 검증 실패"}` };
      }
      return { ok: true, targets };
    } catch (error) {
      return { ok:false, code:"SHOPLING_AUTO_WORKSPACE_FAILED", message:String(error?.message || error) };
    }
  };

  dispatchToTarget = async function dispatchToTargetV030(active, target) {
    if (!active || !target || !await ensureWorkerV030(target, active.stage)) return false;
    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = { ...(active.workTabs || {}), [active.stage]: { tabId: target.tabId, frameId: target.frameId } };
    await saveActive(active);
    const response = await chrome.tabs.sendMessage(target.tabId, { type:"STOCK_SYNC_EXECUTE", job:active.job, stage:active.stage, expectedRole:expectedRole(active.stage), goodsKey:currentGoodsKey(active), goodsKeyIndex:active.goodsKeyIndex, version:VERSION_V030 }, { frameId:target.frameId }).catch(() => null);
    return Boolean(response?.ok && response.ignored !== true);
  };
})();
