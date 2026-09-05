import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = process.cwd();
const GUARD_PATH = path.join(
  ROOT,
  "public",
  "shopling-stock-state-sync",
  "menu-guard-v012.js",
);
const MAIN_PATH = path.join(
  ROOT,
  "public",
  "shopling-stock-state-sync",
  "main-shopling.js",
);
const MANIFEST_PATH = path.join(
  ROOT,
  "public",
  "shopling-stock-state-sync",
  "manifest.json",
);
const DOWNLOAD_ROUTE_PATH = path.join(
  ROOT,
  "src",
  "app",
  "api",
  "shopling-stock-state-sync",
  "download",
  "route.ts",
);

const MENU_QUERY = "a,[onclick],li,td,span,div";

class FakeHTMLElement {
  constructor(textContent, attrs = {}) {
    this.textContent = textContent;
    this.attrs = { ...attrs };
    this.offsetParent = {};
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  getBoundingClientRect() {
    return { width: 10, height: 10 };
  }
}

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function createWindow() {
  const listeners = new Map();
  const window = {
    addEventListener(type, listener) {
      const group = listeners.get(type) || [];
      group.push(listener);
      listeners.set(type, group);
    },
    removeEventListener(type, listener) {
      const group = listeners.get(type) || [];
      listeners.set(
        type,
        group.filter((entry) => entry !== listener),
      );
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  window.top = window;
  return window;
}

async function loadGuard({ candidates, active = null } = {}) {
  const source = await readFile(GUARD_PATH, "utf8");
  const sent = [];
  const document = {
    title: "Shopling",
    querySelectorAll(selector) {
      if (selector === "a,[onclick]" || selector === MENU_QUERY) {
        return candidates || [];
      }
      return [];
    },
  };
  const window = createWindow();
  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          sent.push(message);
          if (message?.type === "STOCK_SYNC_GET_STATUS") {
            return { ok: true, active };
          }
          return { ok: true };
        },
      },
    },
    console,
    CustomEvent: FakeCustomEvent,
    document,
    HTMLElement: FakeHTMLElement,
    location: { href: "https://a.shopling.co.kr/frame/menu.phtml" },
    window,
  });
  vm.runInContext(source, context, { filename: GUARD_PATH });
  return { context, document, sent, window };
}

function menu(textContent, href, onclick = null) {
  return new FakeHTMLElement(textContent, {
    href,
    ...(onclick ? { onclick } : {}),
  });
}

test("Shopling stock guard keeps only the exact A6 menu and rejects the historical fuzzy bad route", async () => {
  const safeA6 = menu("[A6] 옵션대량수정", "/goods/optionBulkModify.phtml");
  const historicalWrongA6 = menu(
    "[A6] 옵션상품수정",
    "/goods/prodBulkOptLst.phtml",
  );
  const { document } = await loadGuard({
    candidates: [historicalWrongA6, safeA6],
  });

  const result = document.querySelectorAll(MENU_QUERY);
  assert.deepEqual(result, [safeA6]);
  assert.ok(!result.includes(historicalWrongA6));
});

test("Shopling stock guard blocks prodBulkOptLst.phtml even when its visible label looks exact", async () => {
  const disguisedWrongRoute = menu(
    "[A6] 옵션대량수정",
    "/goods/prodBulkOptLst.phtml",
  );
  const { document } = await loadGuard({ candidates: [disguisedWrongRoute] });

  assert.deepEqual(document.querySelectorAll(MENU_QUERY), []);
});

test("Shopling stock guard refuses to guess when two distinct exact A6 routes exist", async () => {
  const first = menu("[A6] 옵션대량수정", "/goods/a6-first.phtml");
  const second = menu("[A6] 옵션대량수정", "/goods/a6-second.phtml");
  const { document } = await loadGuard({ candidates: [first, second] });

  assert.deepEqual(document.querySelectorAll(MENU_QUERY), []);
});

test("Shopling access-denied alert fails the active pre-submit job once and disables further menu navigation", async () => {
  const safeA6 = menu("[A6] 옵션대량수정", "/goods/optionBulkModify.phtml");
  const active = {
    status: "RUNNING",
    stage: "A6",
    job: { jobId: "stock-test-job", barcode: "BZZ341-1" },
  };
  const { document, sent, window } = await loadGuard({
    candidates: [safeA6],
    active,
  });

  assert.deepEqual(document.querySelectorAll(MENU_QUERY), [safeA6]);
  window.dispatchEvent(
    new FakeCustomEvent("commerce-os-stock-main-alert", {
      detail: { message: "페이지 접근권한이 없습니다." },
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  const failures = sent.filter(
    (message) => message?.type === "STOCK_SYNC_STEP_RESULT",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].jobId, "stock-test-job");
  assert.equal(failures[0].stage, "A6");
  assert.equal(failures[0].result?.code, "SHOPLING_PERMISSION_DENIED");
  assert.equal(failures[0].result?.ok, false);
  assert.deepEqual(document.querySelectorAll(MENU_QUERY), []);

  window.dispatchEvent(
    new FakeCustomEvent("commerce-os-stock-main-alert", {
      detail: { message: "페이지 접근권한이 없습니다." },
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    sent.filter((message) => message?.type === "STOCK_SYNC_STEP_RESULT").length,
    1,
  );
});

test("MAIN-world alert bridge exposes permission alerts without suppressing the Shopling alert", async () => {
  const source = await readFile(MAIN_PATH, "utf8");
  const window = createWindow();
  const browserAlerts = [];
  const forwarded = [];
  window.alert = (message) => browserAlerts.push(message);
  window.confirm = () => false;
  window.addEventListener("commerce-os-stock-main-alert", (event) => {
    forwarded.push(event.detail);
  });
  const document = {
    title: "Shopling",
    querySelector() {
      return null;
    },
  };
  const context = vm.createContext({
    console,
    CSS: { escape: (value) => String(value) },
    CustomEvent: FakeCustomEvent,
    document,
    HTMLElement: FakeHTMLElement,
    location: { href: "https://a.shopling.co.kr/frame/menu.phtml" },
    MouseEvent: class FakeMouseEvent {},
    setTimeout,
    window,
  });

  vm.runInContext(source, context, { filename: MAIN_PATH });
  window.alert("페이지 접근권한이 없습니다.");

  assert.deepEqual(browserAlerts, ["페이지 접근권한이 없습니다."]);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].message, "페이지 접근권한이 없습니다.");
});

test("v0.1.2 package loads the guard before the legacy content automator and ships it in the ZIP route", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const route = await readFile(DOWNLOAD_ROUTE_PATH, "utf8");
  const shoplingScript = manifest.content_scripts.find(
    (entry) =>
      entry.matches?.includes("https://a.shopling.co.kr/*") &&
      entry.js?.includes("content-shopling-v011.js"),
  );

  assert.equal(manifest.version, "0.1.2");
  assert.deepEqual(shoplingScript?.js, [
    "menu-guard-v012.js",
    "content-shopling-v011.js",
  ]);
  assert.match(route, /const VERSION = "0\.1\.2"/);
  assert.match(route, /"menu-guard-v012\.js"/);
});
