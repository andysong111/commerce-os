import { chromium } from "playwright";

const PROD_URL = process.env.PRODUCT_LAUNCH_SMOKE_URL ||
  "https://commerce-os-ops-center.vercel.app/product-launch-tracker";
const ARCHITECTURE_MARKER = "v2-core-first";
const DEPLOY_WAIT_MS = 4 * 60 * 1_000;
const PAGE_READY_MS = 18_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function trackerFrame(page) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) =>
      candidate.url().includes("/product-launch-tracker-app/index.html"),
    );
    if (frame) return frame;
    await sleep(250);
  }
  throw new Error("상품마스터 iframe을 찾지 못했습니다.");
}

async function waitForProductionMarker(page) {
  const deadline = Date.now() + DEPLOY_WAIT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      await page.goto(`${PROD_URL}?smoke=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const frame = await trackerFrame(page);
      await frame.waitForLoadState("domcontentloaded");
      const marker = await frame.evaluate(
        () => document.documentElement.dataset.productLaunchArchitecture || "",
      );
      last = marker;
      if (marker === ARCHITECTURE_MARKER) return frame;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(10_000);
  }
  throw new Error(`운영 배포 marker 대기 실패: ${last || "marker 없음"}`);
}

async function waitForUsableRows(frame, { requireFallback = false } = {}) {
  const selector = requireFallback
    ? "#launch-table-body tr.master-core-fallback-row"
    : "#launch-table-body tr";
  await frame.waitForSelector(selector, { state: "visible", timeout: PAGE_READY_MS });

  const result = await frame.evaluate(({ requireFallback }) => {
    const rows = [...document.querySelectorAll("#launch-table-body tr")];
    const fallbackRows = rows.filter((row) => row.classList.contains("master-core-fallback-row"));
    const bodyText = document.body.innerText || "";
    const tableWrap = document.querySelector(".table-wrap");
    return {
      architecture: document.documentElement.dataset.productLaunchArchitecture || "",
      title: document.title,
      rowCount: rows.length,
      fallbackRowCount: fallbackRows.length,
      bodyText,
      cursor: tableWrap ? getComputedStyle(tableWrap).cursor : "",
      requireFallback,
    };
  }, { requireFallback });

  if (result.architecture !== ARCHITECTURE_MARKER) {
    throw new Error(`architecture marker 불일치: ${result.architecture}`);
  }
  if (!result.title.includes("상품마스터")) {
    throw new Error(`상품마스터 title 불일치: ${result.title}`);
  }
  if (result.rowCount < 1) {
    throw new Error("상품 목록 행이 표시되지 않았습니다.");
  }
  if (requireFallback && result.fallbackRowCount < 1) {
    throw new Error("OPS 503 상황에서 Product Master fallback 행이 표시되지 않았습니다.");
  }
  if (result.bodyText.includes("This operation was aborted")) {
    throw new Error("중앙 가격정책 abort 기술 오류문구가 다시 노출됐습니다.");
  }
  if (result.bodyText.includes("목록을 불러오지 못했습니다. 새로고침해 주세요.")) {
    throw new Error("상품마스터 목록 전체 실패 문구가 노출됐습니다.");
  }
  if (result.cursor === "progress" || result.cursor === "wait") {
    throw new Error(`상품 테이블이 지속 로딩 커서 상태입니다: ${result.cursor}`);
  }
  return result;
}

async function runNormal(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let fullJobListRequests = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("/api/product-launch-tracker/detail-page-jobs") &&
      !url.includes("/detail-page-jobs/active")
    ) {
      fullJobListRequests += 1;
    }
  });

  const frame = await waitForProductionMarker(page);
  const result = await waitForUsableRows(frame);
  await sleep(8_000);
  if (fullJobListRequests > 6) {
    throw new Error(
      `새 브라우저 한 탭에서 상세페이지 전체 Job 목록 요청이 과도합니다: ${fullJobListRequests}회`,
    );
  }
  console.log(
    `[normal] rows=${result.rowCount} fallback=${result.fallbackRowCount} fullJobListRequests=${fullJobListRequests}`,
  );
  await context.close();
}

async function runWorkflowFailureIsolation(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/api/product-launch-tracker/optimized**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Retry-After": "5" },
      body: JSON.stringify({
        ok: false,
        code: "SMOKE_FORCED_WORKFLOW_UNAVAILABLE",
        message: "browser smoke forced OPS workflow outage",
        retryable: true,
      }),
    });
  });

  await page.goto(`${PROD_URL}?smoke_degraded=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const frame = await trackerFrame(page);
  await frame.waitForLoadState("domcontentloaded");
  const marker = await frame.evaluate(
    () => document.documentElement.dataset.productLaunchArchitecture || "",
  );
  if (marker !== ARCHITECTURE_MARKER) {
    throw new Error(`degraded test architecture marker 불일치: ${marker}`);
  }
  const result = await waitForUsableRows(frame, { requireFallback: true });
  console.log(
    `[workflow-503] rows=${result.rowCount} fallback=${result.fallbackRowCount} cursor=${result.cursor || "default"}`,
  );
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runNormal(browser);
  await runWorkflowFailureIsolation(browser);
  console.log("PRODUCT_LAUNCH_BROWSER_SMOKE_OK");
} finally {
  await browser.close();
}
