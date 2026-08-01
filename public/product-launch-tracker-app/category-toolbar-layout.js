const CATEGORY_TOOLBAR_ID = "shopling-category-management-toolbar";
const REFRESH_BUTTON_ID = "shopling-category-refresh-button";
const STATUS_BADGE_ID = "shopling-category-status-badge";
const AI_BUTTON_ID = "shopling-category-ai-button";
const FRIENDLY_LAYOUT_STYLE_ID = "friendly-product-launch-toolbar-styles";
const BULK_GROUP_IDS = {
  status: "bulk-action-group-status",
  data: "bulk-action-group-data",
  view: "bulk-action-group-view",
};
let installAttempts = 0;
let bulkLayoutObserver = null;
let bulkLayoutQueued = false;

void installCategoryToolbar();

async function installCategoryToolbar() {
  const refreshButton = document.querySelector(`#${REFRESH_BUTTON_ID}`);
  const statusBadge = document.querySelector(`#${STATUS_BADGE_ID}`);
  const aiButton = document.querySelector(`#${AI_BUTTON_ID}`);
  const bulkControls = document.querySelector(".bulk-controls");
  const bulkbar = bulkControls?.closest(".bulkbar");

  if (!refreshButton || !statusBadge || !aiButton || !bulkControls || !bulkbar) {
    installAttempts += 1;
    if (installAttempts < 100) {
      window.setTimeout(() => void installCategoryToolbar(), 100);
    }
    return;
  }

  installFriendlyLayoutStyles();
  normalizeCategoryCopy(refreshButton);
  normalizeCategoryCopy(statusBadge);

  let toolbar = document.querySelector(`#${CATEGORY_TOOLBAR_ID}`);
  if (!toolbar) {
    toolbar = document.createElement("section");
    toolbar.id = CATEGORY_TOOLBAR_ID;
    toolbar.setAttribute("aria-label", "샵플링 카테고리 관리");

    const summary = document.createElement("div");
    summary.className = "shopling-category-management-summary";

    const heading = document.createElement("div");
    heading.className = "shopling-category-management-heading";

    const title = document.createElement("strong");
    title.textContent = "샵플링 표준카테고리";

    const description = document.createElement("span");
    description.textContent =
      "최신 카테고리 목록을 업데이트하고, 선택한 상품에 AI 추천을 적용합니다.";

    heading.append(title, description);
    summary.append(heading, statusBadge);

    const actions = document.createElement("div");
    actions.className = "shopling-category-management-actions";

    makeButtonVisible(refreshButton, true);
    makeButtonVisible(aiButton, false);
    actions.append(refreshButton, aiButton);
    toolbar.append(summary, actions);
  }

  const summary = toolbar.querySelector(
    ".shopling-category-management-summary",
  );
  const actions = toolbar.querySelector(
    ".shopling-category-management-actions",
  );
  if (summary && statusBadge.parentElement !== summary) summary.append(statusBadge);
  if (actions && refreshButton.parentElement !== actions) actions.append(refreshButton);
  if (actions && aiButton.parentElement !== actions) actions.append(aiButton);

  // The old implementation inserted the category toolbar inside `.bulkbar`,
  // forcing both areas to share a narrow horizontal row. Move it outside so
  // both sections always receive the full workspace width.
  const workspace = bulkbar.parentElement;
  if (workspace && toolbar.parentElement !== workspace) {
    workspace.insertBefore(toolbar, bulkbar);
  } else if (workspace && toolbar.nextElementSibling !== bulkbar) {
    workspace.insertBefore(toolbar, bulkbar);
  }

  organizeBulkActions(bulkbar, bulkControls);
  observeBulkActionChanges(bulkbar, bulkControls);
  observeCopy(refreshButton);
  observeCopy(statusBadge);
}

function installFriendlyLayoutStyles() {
  if (document.querySelector(`#${FRIENDLY_LAYOUT_STYLE_ID}`)) return;
  const style = document.createElement("style");
  style.id = FRIENDLY_LAYOUT_STYLE_ID;
  style.textContent = `
    #${CATEGORY_TOOLBAR_ID} {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      margin: 12px 16px 8px;
      padding: 13px 14px;
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      background: linear-gradient(135deg, #eff6ff 0%, #f8fbff 100%);
      box-shadow: 0 3px 10px rgb(37 99 235 / 6%);
    }
    .shopling-category-management-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .shopling-category-management-heading {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .shopling-category-management-heading strong {
      color: #1e3a8a;
      font-size: 13px;
      line-height: 1.25;
      white-space: nowrap;
    }
    .shopling-category-management-heading span {
      color: #64748b;
      font-size: 11px;
      line-height: 1.45;
    }
    #${STATUS_BADGE_ID} {
      display: inline-flex;
      align-items: center;
      min-height: 27px;
      max-width: 290px;
      padding: 5px 9px;
      border: 1px solid #dbeafe;
      border-radius: 999px;
      background: #fff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 0 1 auto;
    }
    .shopling-category-management-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
    .shopling-category-management-actions .button {
      min-height: 35px;
      padding: 7px 12px;
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .bulkbar.friendly-bulkbar {
      display: grid !important;
      grid-template-columns: minmax(112px, auto) minmax(0, 1fr);
      align-items: start !important;
      gap: 12px !important;
      min-height: 0 !important;
      padding: 11px 16px 13px !important;
      background: #fafcff;
    }
    .bulkbar.friendly-bulkbar > .bulk-selection-summary {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 44px;
      padding: 9px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      white-space: nowrap;
    }
    .bulkbar.friendly-bulkbar > .bulk-selection-summary strong {
      margin: 0;
    }
    .bulk-controls.friendly-bulk-controls {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(220px, 1fr));
      align-items: stretch !important;
      gap: 9px !important;
      width: 100%;
      min-width: 0;
    }
    .bulk-action-group {
      display: flex;
      align-content: flex-start;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
      padding: 9px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
    }
    .bulk-action-group-title {
      width: 100%;
      margin-bottom: 1px;
      color: #64748b;
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .02em;
    }
    .bulk-action-group select {
      flex: 1 1 120px;
      width: auto !important;
      min-width: 112px !important;
      max-width: 100%;
      min-height: 34px;
      padding: 7px 8px !important;
    }
    .bulk-action-group .button {
      min-height: 34px;
      min-width: max-content;
      padding: 7px 10px;
      white-space: nowrap !important;
      writing-mode: horizontal-tb !important;
      word-break: keep-all !important;
      flex: 0 0 auto;
    }
    .bulk-action-group #table-layout-controls {
      display: flex !important;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      width: 100%;
      padding-left: 0 !important;
    }
    .bulk-action-group #table-layout-controls label {
      flex: 1 1 145px;
      min-width: 0;
    }
    .bulk-action-group #table-layout-controls label select {
      width: 100% !important;
    }
    .bulk-action-group .table-layout-hint {
      width: 100%;
      line-height: 1.35;
    }
    @media (max-width: 1500px) {
      .bulk-controls.friendly-bulk-controls {
        grid-template-columns: repeat(2, minmax(250px, 1fr));
      }
      #${CATEGORY_TOOLBAR_ID} {
        grid-template-columns: 1fr;
      }
      .shopling-category-management-actions {
        justify-content: flex-start;
      }
    }
    @media (max-width: 1220px) {
      .bulkbar.friendly-bulkbar {
        grid-template-columns: 1fr;
      }
      .bulk-controls.friendly-bulk-controls {
        grid-template-columns: 1fr;
      }
      .shopling-category-management-summary {
        align-items: flex-start;
        flex-direction: column;
      }
      #${STATUS_BADGE_ID} {
        max-width: 100%;
      }
    }
  `;
  document.head.append(style);
}

function organizeBulkActions(bulkbar, bulkControls) {
  if (!bulkbar || !bulkControls) return;
  bulkbar.classList.add("friendly-bulkbar");
  bulkControls.classList.add("friendly-bulk-controls");

  const summary = [...bulkbar.children].find(
    (child) => child !== bulkControls && child.id !== CATEGORY_TOOLBAR_ID,
  );
  if (summary) summary.classList.add("bulk-selection-summary");

  const statusGroup = ensureBulkGroup(
    bulkControls,
    BULK_GROUP_IDS.status,
    "단계·상태 변경",
  );
  const dataGroup = ensureBulkGroup(
    bulkControls,
    BULK_GROUP_IDS.data,
    "선택 상품 작업",
  );
  const viewGroup = ensureBulkGroup(
    bulkControls,
    BULK_GROUP_IDS.view,
    "표 보기 설정",
  );

  moveControl("#bulk-stage", statusGroup);
  moveControl("#bulk-status", statusGroup);
  moveControl("#bulk-apply-button", statusGroup);

  moveControl("#bulk-china-order-sync-button", dataGroup);
  moveControl("#bulk-relaunch-reset-button", dataGroup);
  moveControl("#clear-selection-button", dataGroup);

  moveControl("#table-layout-controls", viewGroup);

  // Keep any future controls readable instead of leaving them as compressed
  // direct children. Unknown controls are placed with selected-product actions.
  for (const child of [...bulkControls.children]) {
    if (child.classList.contains("bulk-action-group")) continue;
    dataGroup.append(child);
  }
}

function ensureBulkGroup(container, id, labelText) {
  let group = container.querySelector(`#${id}`);
  if (!group) {
    group = document.createElement("section");
    group.id = id;
    group.className = "bulk-action-group";
    const title = document.createElement("strong");
    title.className = "bulk-action-group-title";
    title.textContent = labelText;
    group.append(title);
    container.append(group);
  }
  return group;
}

function moveControl(selector, destination) {
  const control = document.querySelector(selector);
  if (!control || !destination || control.parentElement === destination) return;
  destination.append(control);
}

function observeBulkActionChanges(bulkbar, bulkControls) {
  if (bulkLayoutObserver) return;
  bulkLayoutObserver = new MutationObserver(() => {
    if (bulkLayoutQueued) return;
    bulkLayoutQueued = true;
    window.requestAnimationFrame(() => {
      bulkLayoutQueued = false;
      organizeBulkActions(bulkbar, bulkControls);
    });
  });
  bulkLayoutObserver.observe(bulkControls, { childList: true, subtree: true });
}

function makeButtonVisible(button, primary) {
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "35px",
    minWidth: primary ? "172px" : "190px",
    padding: "7px 12px",
    borderRadius: "8px",
    whiteSpace: "nowrap",
    writingMode: "horizontal-tb",
    wordBreak: "keep-all",
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
  observer.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
