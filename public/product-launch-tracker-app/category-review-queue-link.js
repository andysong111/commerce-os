const REVIEW_ROUTE = "/shopling-category-review-queue";
const REVIEW_LINK_ID = "shopling-category-review-queue-link";
const STATE_ENDPOINT = "/api/product-launch-tracker/state";

installReviewQueueLink();
void refreshReviewQueueCount();
window.addEventListener("storage", (event) => {
  if (event.key === "commerce-os-product-launch-tracker:v2") {
    void refreshReviewQueueCount();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshReviewQueueCount();
});

function installReviewQueueLink() {
  if (document.querySelector(`#${REVIEW_LINK_ID}`)) return;
  const aiButton = document.querySelector("#shopling-category-ai-button");
  if (!aiButton?.parentElement) {
    window.setTimeout(installReviewQueueLink, 300);
    return;
  }
  const link = document.createElement("a");
  link.id = REVIEW_LINK_ID;
  link.href = REVIEW_ROUTE;
  link.className = "button button-ghost";
  link.textContent = "AI 카테고리 검토함";
  link.title = "AI 추천 카테고리의 검토 필요·보류·승인 이력을 확인합니다.";
  link.style.whiteSpace = "nowrap";
  link.style.textDecoration = "none";
  aiButton.insertAdjacentElement("afterend", link);
}

async function refreshReviewQueueCount() {
  installReviewQueueLink();
  const link = document.querySelector(`#${REVIEW_LINK_ID}`);
  if (!(link instanceof HTMLAnchorElement)) return;
  try {
    const response = await fetch(STATE_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.state?.items)) return;
    const count = body.state.items.filter((item) => {
      if (!item || typeof item !== "object" || item.archivedAt) return false;
      return item.categoryAiStatus === "review_required" || item.categoryAiStatus === "review_held";
    }).length;
    link.textContent = count
      ? `AI 카테고리 검토함 (${count}건)`
      : "AI 카테고리 검토함";
    link.dataset.count = String(count);
    link.style.borderColor = count ? "#f59e0b" : "";
    link.style.color = count ? "#92400e" : "";
    link.style.background = count ? "#fffbeb" : "";
  } catch {
    // The link remains usable even if the count request fails.
  }
}
