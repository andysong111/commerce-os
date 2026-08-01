const CATEGORY_TOOLBAR_ID = "shopling-category-management-toolbar";
const REFRESH_BUTTON_ID = "shopling-category-refresh-button";
const STATUS_BADGE_ID = "shopling-category-status-badge";
const AI_BUTTON_ID = "shopling-category-ai-button";
let installAttempts = 0;

void installCategoryToolbar();

async function installCategoryToolbar() {
  const refreshButton = document.querySelector(`#${REFRESH_BUTTON_ID}`);
  const statusBadge = document.querySelector(`#${STATUS_BADGE_ID}`);
  const aiButton = document.querySelector(`#${AI_BUTTON_ID}`);
  const bulkControls = document.querySelector(".bulk-controls");

  if (!refreshButton || !statusBadge || !aiButton || !bulkControls) {
    installAttempts += 1;
    if (installAttempts < 80) {
      window.setTimeout(() => void installCategoryToolbar(), 100);
    }
    return;
  }

  normalizeCategoryCopy(refreshButton);
  normalizeCategoryCopy(statusBadge);

  let toolbar = document.querySelector(`#${CATEGORY_TOOLBAR_ID}`);
  if (!toolbar) {
    toolbar = document.createElement("section");
    toolbar.id = CATEGORY_TOOLBAR_ID;
    toolbar.setAttribute("aria-label", "샵플링 카테고리 관리");
    Object.assign(toolbar.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: "10px",
      width: "100%",
      boxSizing: "border-box",
      margin: "8px 0 10px",
      padding: "10px 12px",
      border: "1px solid #bfdbfe",
      borderRadius: "10px",
      background: "#eff6ff",
    });

    const summary = document.createElement("div");
    summary.className = "shopling-category-management-summary";
    Object.assign(summary.style, {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "8px",
      minWidth: "240px",
    });

    const title = document.createElement("strong");
    title.textContent = "샵플링 표준카테고리";
    Object.assign(title.style, {
      fontSize: "12px",
      color: "#1e3a8a",
      whiteSpace: "nowrap",
    });

    const description = document.createElement("span");
    description.textContent = "최신 카테고리 데이터 관리 및 선택 상품 AI 자동설정";
    Object.assign(description.style, {
      fontSize: "11px",
      color: "#64748b",
      whiteSpace: "nowrap",
    });

    summary.append(title, statusBadge, description);

    const actions = document.createElement("div");
    actions.className = "shopling-category-management-actions";
    Object.assign(actions.style, {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "8px",
      marginLeft: "auto",
    });

    makeButtonVisible(refreshButton, true);
    makeButtonVisible(aiButton, false);
    actions.append(refreshButton, aiButton);
    toolbar.append(summary, actions);

    bulkControls.parentElement?.insertBefore(toolbar, bulkControls);
  } else {
    const summary = toolbar.querySelector(".shopling-category-management-summary");
    const actions = toolbar.querySelector(".shopling-category-management-actions");
    if (summary && statusBadge.parentElement !== summary) summary.append(statusBadge);
    if (actions && refreshButton.parentElement !== actions) actions.append(refreshButton);
    if (actions && aiButton.parentElement !== actions) actions.append(aiButton);
  }

  observeCopy(refreshButton);
  observeCopy(statusBadge);
}

function makeButtonVisible(button, primary) {
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "34px",
    minWidth: primary ? "176px" : "190px",
    padding: "7px 12px",
    borderRadius: "8px",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
    fontSize: "12px",
    fontWeight: "800",
  });
  if (primary) {
    button.style.background = "#ffffff";
    button.style.color = "#1d4ed8";
    button.style.border = "1px solid #60a5fa";
  }
}

function normalizeCategoryCopy(element) {
  const current = element.textContent ?? "";
  const next = current
    .replaceAll("샵플링 카테고리 최신화", "샵플링 카테고리 업데이트")
    .replaceAll("최신화 요청 중", "업데이트 요청 중")
    .replaceAll("최초 최신화 필요", "최초 업데이트 필요")
    .replaceAll("카테고리: 최신화 실패", "카테고리: 업데이트 실패");
  if (next !== current) element.textContent = next;
  if (element instanceof HTMLElement && element.title) {
    element.title = element.title.replaceAll("최신화", "업데이트");
  }
}

function observeCopy(element) {
  if (element.dataset.categoryCopyObserver === "1") return;
  element.dataset.categoryCopyObserver = "1";
  const observer = new MutationObserver(() => normalizeCategoryCopy(element));
  observer.observe(element, { childList: true, subtree: true, characterData: true });
}
