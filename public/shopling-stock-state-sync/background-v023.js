importScripts("background-v020.js");

// Price-resend pattern: preserve the authenticated source; create dedicated workers.
// No reload, copied cookies, guessed endpoint, or A22 navigation is used.
(() => {
  const WORKSPACE_KEY = "commerceStockWorkspaceV023";
  const WORKER_FILE = "content-shopling-v023.js";
  const labels = { A4: "상품조회수정", A6: "옵션대량수정", A21_LIST: "쇼핑몰상품수정" };
  const numbers = { A4: "4", A6: "6", A21_LIST: "21" };
  const baseStart = start, baseFinish = finish;
  const basePageReady = handlePageReady, baseStepResult = handleStepResult, baseEvidence = handleEvidence;
  let starting = false, setupCancelled = false;
  let workspace = null;

  async function scan(tabId) {
    return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
      const text = String(document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ");
      const selects = [...document.querySelectorAll("select")];
      const has = (label) => selects.some((s) => [...s.options].some((o) => String(o.textContent).replace(/\s/g, "") === label));
      let role = "OTHER";
      if (/상품수정\s*송신/.test(text) && /상품판매상태송신|옵션송신/.test(text)) role = "A21_POPUP";
      else if (/쇼핑몰상품수정/.test(text) && /검색항목/.test(text) && has("샵플링상품코드") && (/\[A?21\]/.test(text) || /상품\s*수정전송/.test(text))) role = "A21_LIST";
      else if (/옵션대량수정/.test(text) && /검색항목/.test(text) && has("옵션자체관리코드")) role = "A6";
      else if (/상품조회수정/.test(text) && /검색항목/.test(text)) role = "A4";
      const authenticated = /로그아웃/.test(text) || [...document.querySelectorAll("a[href]")].some((a) => /logout/i.test(a.getAttribute("href")));
      return { role, authenticated, href: location.href, title: document.title, ready: document.readyState };
    }}).catch(() => []);
  }
  async function targetIn(tab, stage) {
    if (!Number.isInteger(tab?.id)) return null;
    const rows = await scan(tab.id);
    const row = rows.find((r) => r.result?.role === expectedRole(stage));
    return row ? { tabId: tab.id, windowId: tab.windowId, frameId: row.frameId, role: row.result.role,
      page: { role: row.result.role, href: row.result.href, title: row.result.title, canNavigate: false } } : null;
  }
  async function getWorkspace() {
    if (!workspace) workspace = (await chrome.storage.local.get(WORKSPACE_KEY))[WORKSPACE_KEY] || null;
    return workspace;
  }
  async function saveWorkspace(value) {
    workspace = value;
    await chrome.storage.local.set({ [WORKSPACE_KEY]: value });
  }
  async function relatedTab(tabId, ws) {
    const roots = new Set(Object.values(ws?.targets || {}).map((t) => t.tabId));
    let current = tabId;
    for (let depth = 0; Number.isInteger(current) && depth < 5; depth++) {
      if (roots.has(current)) return true;
      const tab = await chrome.tabs.get(current).catch(() => null);
      current = tab?.openerTabId;
    }
    return false;
  }
  findExactRoleTarget = async function findExactRoleTargetV023(stage) {
    const ws = await getWorkspace();
    if (!ws) return null;
    if (labels[stage]) {
      const saved = ws.targets?.[stage];
      const tab = saved && await chrome.tabs.get(saved.tabId).catch(() => null);
      return tab ? targetIn(tab, stage) : null;
    }
    for (const tab of await shoplingTabs()) {
      if (ws.baselineTabIds?.includes(tab.id)) continue;
      if (!await relatedTab(tab.id, ws)) continue;
      const target = await targetIn(tab, stage);
      if (target) return target;
    }
    return null;
  };
  async function ensureWorker(target, stage) {
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs.sendMessage(target.tabId, { type: "STOCK_SYNC_PROBE", stage }, options).catch(() => null);
    if (probe?.version === "0.2.3" && probe.page?.role === expectedRole(stage)) return true;
    await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [target.frameId] }, files: [WORKER_FILE] });
    probe = await chrome.tabs.sendMessage(target.tabId, { type: "STOCK_SYNC_PROBE", stage }, options).catch(() => null);
    return probe?.version === "0.2.3" && probe.page?.role === expectedRole(stage);
  }
  async function chooseSource() {
    for (const tab of await shoplingTabs()) {
      if (/trsmt|result/i.test(tab.url || "")) continue;
      const rows = await scan(tab.id);
      if (rows.some((r) => r.result?.authenticated)) return tab;
    }
    return null;
  }
  async function clickExactMenu(tabId, stage) {
    const candidates = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", func: (label, number) => {
      const clean = (v) => String(v || "").replace(/\s/g, "");
      const allowed = new Set([label, `[${number}]${label}`, `[A${number}]${label}`, `A${number}${label}`]);
      const nodes = [...document.querySelectorAll('a,button,input[type="button"],[onclick]')];
      const found = nodes.filter((n) => allowed.has(clean(n.textContent || n.value)));
      // Hidden hover-menu links can be read without opening the hover menu.
      found.sort((a, b) => Number(b.tagName === "A") - Number(a.tagName === "A"));
      return found.length ? { label, number, count: found.length } : null;
    }, args: [labels[stage], numbers[stage]] }).catch(() => []);
    const candidate = candidates.find((r) => r.result);
    if (!candidate) return false;
    const result = await chrome.scripting.executeScript({ target: { tabId, frameIds: [candidate.frameId] }, world: "MAIN", func: (label, number) => {
      const clean = (v) => String(v || "").replace(/\s/g, "");
      const allowed = new Set([label, `[${number}]${label}`, `[A${number}]${label}`, `A${number}${label}`]);
      const found = [...document.querySelectorAll('a,button,input[type="button"],[onclick]')].filter((n) => allowed.has(clean(n.textContent || n.value)));
      found.sort((a, b) => Number(b.tagName === "A") - Number(a.tagName === "A"));
      const node = found[0];
      if (!node) return false;
      // Exact menu entry only, in the site's MAIN context, like the price worker.
      node.click();
      return true;
    }, args: [labels[stage], numbers[stage]] }).catch(() => []);
    return result.some((r) => r.result === true);
  }
  async function openWorker(source, stage, job) {
    await broadcast("STOCK_SYNC_PROGRESS", { jobId: job.jobId, job, stage: "PREPARING_TABS", message: `${labels[stage]} 전용 작업창을 자동으로 준비합니다. 관리자 탭은 유지합니다.` });
    const created = await chrome.windows.create({ url: source.url || SHOPLING_ORIGIN, type: "popup", width: 1420, height: 900, focused: false });
    const tab = created.tabs?.[0];
    if (!Number.isInteger(tab?.id)) throw new Error(`${labels[stage]} 작업창을 만들지 못했습니다.`);
    // Persist ownership before awaiting navigation so restart/stop never adopts a user tab.
    const ws = await getWorkspace();
    ws.targets[stage] = { tabId: tab.id, windowId: created.id, owned: true };
    await saveWorkspace(ws);
    let clicked = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (setupCancelled) throw new Error("작업창 준비를 중지했습니다.");
      const target = await targetIn({ ...tab, windowId: created.id }, stage);
      if (target) return target;
      if (!clicked) clicked = await clickExactMenu(tab.id, stage);
      await sleep(250);
    }
    throw new Error(`${labels[stage]} 자동진입을 확인하지 못했습니다. 로그인 상태와 새 작업창을 확인하세요. 상품은 변경하지 않았습니다.`);
  }
  preflightWorkTabs = async function preflightWorkTabsV023(job) {
    let ws = await getWorkspace();
    if (!ws || ws.executionId !== job.executionId) {
      const source = await chooseSource();
      if (!source) return { ok: false, code: "SHOPLING_LOGIN_REQUIRED", message: "로그인 완료된 Shopling 관리자 메인 탭을 하나 열어두세요. 아이디·비밀번호 입력 화면만으로는 실행할 수 없습니다." };
      // Keep previous failed windows for inspection; never navigate/reload/close the user's source tab.
      ws = { executionId: job.executionId, sourceTabId: source.id, sourceUrl: source.url, targets: {}, baselineTabIds: (await shoplingTabs()).map((t) => t.id) };
      await saveWorkspace(ws);
    }
    const source = await chrome.tabs.get(ws.sourceTabId).catch(() => null);
    if (!source) return { ok: false, code: "SHOPLING_SOURCE_TAB_CLOSED", message: "관리자 로그인 탭이 닫혔습니다." };
    const targets = {};
    try {
      for (const stage of requiredStages(job.productKind)) {
        const saved = ws.targets[stage];
        const currentTab = saved && await chrome.tabs.get(saved.tabId).catch(() => null);
        const target = (currentTab && await targetIn(currentTab, stage)) || await openWorker(source, stage, job);
        if (!await ensureWorker(target, stage)) throw new Error(`${labels[stage]} 작업 코드 연결을 확인하지 못했습니다. 상품은 변경하지 않았습니다.`);
        targets[stage] = target;
        ws.targets[stage] = { ...target, owned: true };
        await saveWorkspace(ws);
      }
      // Preflight both date pairs BEFORE any option/product state mutation.
      for (const stage of requiredStages(job.productKind)) {
        const t = targets[stage];
        const results = await chrome.scripting.executeScript({ target: { tabId: t.tabId, frameIds: [t.frameId] }, func: () => {
          const setter = (el, value) => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value === value; };
          return globalThis.CommerceStockSearchV023.applyPeriod(document, setter);
        }});
        const date = results[0]?.result;
        if (!date?.ok) return { ok: false, code: date?.code || "SEARCH_DATE_VERIFY_FAILED", message: `${labels[stage]}: ${date?.message || "검색기간을 확인하지 못했습니다."}` };
      }
      return { ok: true, targets };
    } catch (error) {
      return { ok: false, code: "SHOPLING_AUTO_WORKSPACE_FAILED", message: String(error.message || error) };
    }
  };
  dispatchToTarget = async function dispatchToTargetV023(active, target) {
    if (!active || !target || !await relatedTab(target.tabId, await getWorkspace())) return false;
    if (!await ensureWorker(target, active.stage)) return false;
    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = { ...(active.workTabs || {}), [active.stage]: { tabId: target.tabId, frameId: target.frameId } };
    await saveActive(active);
    const response = await chrome.tabs.sendMessage(target.tabId, { type: "STOCK_SYNC_EXECUTE", job: active.job, stage: active.stage,
      expectedRole: expectedRole(active.stage), goodsKey: currentGoodsKey(active), version: "0.2.3" }, { frameId: target.frameId }).catch(() => null);
    return response?.ok === true && response.ignored !== true;
  };
  handlePageReady = async function pageReadyV023(message, sender) {
    const active = await loadActive();
    if (!active || !await relatedTab(sender?.tab?.id, await getWorkspace())) return { ok: true, ignored: true };
    if (labels[active.stage] && active.workTabs?.[active.stage]?.tabId !== sender.tab.id) return { ok: true, ignored: true };
    return basePageReady(message, sender);
  };
  handleStepResult = async function stepResultV023(message, sender) {
    const active = await loadActive();
    if (!active || active.shoplingTabId !== sender?.tab?.id || active.shoplingFrameId !== sender?.frameId) return { ok: true, ignored: true };
    return baseStepResult(message, sender);
  };
  handleEvidence = async function evidenceV023(message, sender) {
    const ws = await getWorkspace();
    if (!ws || ws.baselineTabIds.includes(sender?.tab?.id) || !await relatedTab(sender?.tab?.id, ws)) return { ok: true, ignored: true };
    return baseEvidence(message, sender);
  };
  start = async function startV023(input) {
    if (starting) return { ok: false, code: "STOCK_SYNC_PREPARING", message: "작업창을 준비 중입니다. 중복 실행하지 마세요." };
    const current = await loadActive();
    if (current?.status === "RUNNING") return baseStart(input);
    const normalized = validJob(input);
    if (!normalized.ok) return normalized;
    starting = true; setupCancelled = false;
    try {
      const job = { ...normalized.job, executionId: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      return await baseStart(job);
    } finally { starting = false; }
  };
  finish = async function finishV023(active, outcome, message, evidence) {
    // Retain failed/uncertain work windows; they are evidence, not successful transfers.
    return baseFinish(active, outcome, message, { ...evidence, extensionVersion: "0.2.3", searchStart: "2024-01-01" });
  };
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === "STOCK_SYNC_STOP") setupCancelled = true; });
})();
