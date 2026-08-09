const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const REPAIR_INTERVAL_MS = 5_000;
const MAX_REPAIRS_PER_PASS = 24;

let repairing = false;
let lastCompletedSignature = "";

void repairRecentSuccessfulDocks();
window.setInterval(() => void repairRecentSuccessfulDocks(), REPAIR_INTERVAL_MS);
window.addEventListener("focus", () => void repairRecentSuccessfulDocks());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void repairRecentSuccessfulDocks();
});

async function repairRecentSuccessfulDocks() {
  if (repairing) return;
  repairing = true;
  try {
    const response = await fetch(JOBS_API, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.jobs)) return;

    const latestByItem = new Map();
    for (const job of payload.jobs) {
      if (!isSuccessfulDockCandidate(job)) continue;
      const existing = latestByItem.get(String(job.itemId));
      if (!existing || jobTime(job) > jobTime(existing)) {
        latestByItem.set(String(job.itemId), job);
      }
    }
    const candidates = [...latestByItem.values()]
      .sort((left, right) => jobTime(right) - jobTime(left))
      .slice(0, MAX_REPAIRS_PER_PASS);
    const signature = candidates
      .map((job) => `${job.jobId}:${job.completedAt || job.updatedAt || ""}`)
      .join("|");
    if (signature && signature === lastCompletedSignature) return;

    let changed = false;
    for (const job of candidates) {
      changed = (await repairOneJob(job)) || changed;
    }
    if (!changed) lastCompletedSignature = signature;
  } catch (error) {
    console.warn("[detail-page-dock-repair] recent success repair skipped", error);
  } finally {
    repairing = false;
  }
}

async function repairOneJob(job) {
  const itemId = String(job.itemId || "").trim();
  if (!itemId) return false;
  const itemResponse = await fetch(
    `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  const itemBody = await itemResponse.json().catch(() => ({}));
  if (!itemResponse.ok || itemBody?.ok !== true || !itemBody.item) return false;

  const item = itemBody.item;
  const result = job.result || {};
  const detailImageUrl = cleanUrl(result.detailImageUrl || result.detail_image_url);
  const mainImageUrl = cleanUrl(result.mainImageUrl || result.main_image_url);
  const additionalImageUrls = Array.isArray(
    result.additionalImageUrls || result.additional_image_urls,
  )
    ? (result.additionalImageUrls || result.additional_image_urls)
        .map(cleanUrl)
        .filter(Boolean)
        .slice(0, 4)
    : [];
  if (!detailImageUrl || !mainImageUrl || additionalImageUrls.length !== 4) {
    return false;
  }

  const currentAutomation = record(item.detailPageAutomation);
  const currentAsset = record(item.detailPageAsset);
  const currentJobId = String(currentAutomation.jobId || "").trim();
  if (
    currentJobId &&
    currentJobId !== job.jobId &&
    ["queued", "collecting", "running", "uploading", "render_pending"].includes(
      String(currentAutomation.status || ""),
    )
  ) {
    return false;
  }
  if (
    currentAsset.resultId &&
    currentAsset.resultId !== job.jobId &&
    timestamp(currentAsset.syncedAt) > jobTime(job)
  ) {
    return false;
  }

  const completedAt = String(job.completedAt || job.updatedAt || new Date().toISOString());
  const productName = String(
    job.payload?.product_name_hint ||
      job.payload?.product_name ||
      item.productName ||
      item.modelNumber ||
      "상품",
  ).trim();
  const detailHtml = buildDetailHtml(detailImageUrl, productName);
  const alreadyDocked =
    currentAsset.resultId === job.jobId &&
    currentAsset.html === detailHtml &&
    currentAsset.detailImageUrl === detailImageUrl &&
    currentAsset.mainImageUrl === mainImageUrl &&
    sameList(currentAsset.additionalImageUrls, additionalImageUrls) &&
    currentAutomation.status === "completed";
  if (alreadyDocked) return false;

  const stages = record(item.stages);
  const detailStage = record(stages.detailPage);
  const patch = {
    detailPageAsset: {
      ...currentAsset,
      status: "ready",
      resultId: job.jobId,
      html: detailHtml,
      detailImageUrl,
      mainImageUrl,
      additionalImageUrls,
      syncedAt: completedAt,
    },
    detailPageAutomation: {
      ...currentAutomation,
      jobId: job.jobId,
      status: "completed",
      stage: "docked",
      message: "검수 통과 · 상세 HTML과 이미지 URL 서버 원장 도킹 완료",
      progress: 100,
      qaStatus: "passed",
      completedAt,
      error: "",
      executionMode: "server-v1",
    },
    stages: {
      ...stages,
      detailPage: {
        ...detailStage,
        status: "완료",
        completedAt,
        note: "상세페이지 서버 자동 생성·검수 통과 후 결과 도킹",
      },
    },
    updatedAt: completedAt,
    updatedBy: "상세페이지 성공 도킹 복구",
  };

  const saveResponse = await fetch(OPTIMIZED_API, {
    method: "PATCH",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation: "patch_item",
      itemId,
      patch,
      updatedBy: "상세페이지 성공 도킹 복구",
    }),
  });
  const saveBody = await saveResponse.json().catch(() => ({}));
  if (!saveResponse.ok || saveBody?.ok !== true) {
    throw new Error(saveBody?.message || `상품출시진행관리 도킹 복구 실패 (${itemId})`);
  }
  console.info("[detail-page-dock-repair] restored", {
    itemId,
    jobId: job.jobId,
  });
  return true;
}

function isSuccessfulDockCandidate(job) {
  if (!job || job.status !== "success" || job.qaStatus !== "passed") return false;
  const result = job.result || {};
  const additional = result.additionalImageUrls || result.additional_image_urls;
  return Boolean(
    cleanUrl(result.detailImageUrl || result.detail_image_url) &&
      cleanUrl(result.mainImageUrl || result.main_image_url) &&
      Array.isArray(additional) &&
      additional.map(cleanUrl).filter(Boolean).length >= 4,
  );
}

function buildDetailHtml(url, productName) {
  const safeUrl = escapeAttribute(url);
  const safeName = escapeAttribute(productName || "상품 상세페이지");
  return `<div style="margin:0 auto;max-width:1000px;text-align:center;"><img src="${safeUrl}" alt="${safeName}" style="display:block;width:100%;height:auto;margin:0 auto;" loading="lazy"></div>`;
}

function cleanUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sameList(left, right) {
  const a = Array.isArray(left) ? left.map(String) : [];
  const b = Array.isArray(right) ? right.map(String) : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function jobTime(job) {
  return timestamp(job?.completedAt || job?.updatedAt || job?.createdAt);
}
