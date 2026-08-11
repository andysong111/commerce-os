const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

void syncBGradeMainOnlyJobs();
window.setInterval(() => void syncBGradeMainOnlyJobs(), POLL_MS);

async function syncBGradeMainOnlyJobs() {
  try {
    const response = await fetch(JOBS_API, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.jobs)) return;

    for (const job of payload.jobs) {
      if (
        job?.status !== "success" ||
        job?.result?.bGradeMainOnly !== true
      ) {
        continue;
      }
      applyBGradeMainOnlyJob(job);
    }
  } catch {
    // Main tracker polling remains authoritative; this is only the main-only dock adapter.
  }
}

function applyBGradeMainOnlyJob(job) {
  const detailImageUrl = String(job?.result?.detailImageUrl || "").trim();
  const mainImageUrl = String(job?.result?.mainImageUrl || "").trim();
  if (!detailImageUrl || !mainImageUrl) return;

  const state = readState();
  if (!Array.isArray(state?.items)) return;
  const item = state.items.find(
    (candidate) => String(candidate?.id) === String(job?.itemId),
  );
  if (!item || item?.detailPageAutomation?.jobId !== job?.jobId) return;

  const now = job?.completedAt || new Date().toISOString();
  const productName = item.productName || item.modelNumber || "상품";
  const detailHtml = buildDetailHtml(detailImageUrl, productName);
  const currentAsset = item.detailPageAsset || {};
  if (
    currentAsset.resultId === job.jobId &&
    currentAsset.detailImageUrl === detailImageUrl &&
    currentAsset.mainImageUrl === mainImageUrl &&
    Array.isArray(currentAsset.additionalImageUrls) &&
    currentAsset.additionalImageUrls.length === 0 &&
    currentAsset.syncedAt === now
  ) {
    return;
  }

  patchItem(job.itemId, (current) => ({
    detailPageAsset: {
      ...current.detailPageAsset,
      status: "ready",
      resultId: job.jobId,
      html: detailHtml,
      detailImageUrl,
      mainImageUrl,
      additionalImageUrls: [],
      syncedAt: now,
    },
    detailPageAutomation: {
      ...current.detailPageAutomation,
      status: "completed",
      stage: "docked",
      message: "검수 통과 · B급 대표이미지 1장과 상세페이지 도킹 완료",
      progress: 100,
      qaStatus: "passed",
      completedAt: now,
      error: "",
      executionMode: "server-v1",
    },
    stages: {
      ...current.stages,
      detailPage: {
        ...current.stages?.detailPage,
        status: "완료",
        completedAt: now,
        note: "B급 상세페이지 + 대표이미지 1장 도킹 · 부가이미지 미생성",
      },
    },
    updatedAt: now,
    updatedBy: "B급 대표이미지 1장 자동 도킹",
  }));
}

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function patchItem(itemId, patch) {
  const state = readState();
  if (!Array.isArray(state?.items)) return;
  const now = new Date().toISOString();
  state.items = state.items.map((item) => {
    if (String(item.id) !== String(itemId)) return item;
    const changes = typeof patch === "function" ? patch(item) : patch;
    return { ...item, ...changes, updatedAt: changes.updatedAt || now };
  });
  state.savedAt = now;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
}

function buildDetailHtml(url, productName) {
  const safeUrl = escapeAttribute(url);
  const safeName = escapeAttribute(productName || "상품 상세페이지");
  return `<div style="margin:0 auto;max-width:1000px;text-align:center;"><img src="${safeUrl}" alt="${safeName}" style="display:block;width:100%;height:auto;margin:0 auto;" loading="lazy"></div>`;
}

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
