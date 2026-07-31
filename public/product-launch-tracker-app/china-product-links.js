import {
  applyChinaProductLinks,
  MAX_CHINA_PRODUCT_LINKS,
  normalizeChinaProductLinks,
  normalizeChinaProductUrl,
  promoteChinaProductLink,
  readChinaProductLinks,
  sameChinaProductLinks,
} from "./lib/china-product-links.mjs";

const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const REOPEN_ITEM_KEY = "productLaunchTracker.chinaLinks.reopenItem";
const SAVED_ITEM_KEY = "productLaunchTracker.chinaLinks.savedItem";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
let pendingSave = null;
let renderTimers = [];

installStyles();

if (detailDialog && detailForm) {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button[data-action='detail']")) scheduleRender();
    },
    true,
  );

  detailDialog.addEventListener("close", () => {
    clearRenderTimers();
    const section = document.querySelector("#china-product-links-section");
    if (section) {
      section.dataset.itemId = "";
      section.dataset.dirty = "false";
    }
  });

  detailForm.addEventListener("submit", validateBeforeSave, true);
  detailForm.addEventListener("submit", persistAfterMainSave);
}

scheduleReopenSavedItem();

function installStyles() {
  if (document.querySelector("#china-product-links-style")) return;
  const style = document.createElement("style");
  style.id = "china-product-links-style";
  style.textContent = `
    .china-link-list { display: grid; gap: 10px; margin-top: 14px; }
    .china-link-row { display: grid; grid-template-columns: minmax(105px, 140px) minmax(260px, 1fr) auto auto; gap: 8px; align-items: center; }
    .china-link-number { font-size: 12px; font-weight: 900; color: #475569; }
    .china-link-number.is-primary { color: #1d4ed8; }
    .china-link-input { width: 100%; min-width: 0; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font-size: 13px; background: #fff; }
    .china-link-input:focus { outline: 2px solid #bfdbfe; border-color: #2563eb; }
    .china-link-action { white-space: nowrap; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; padding: 9px 11px; font-size: 12px; font-weight: 800; cursor: pointer; }
    .china-link-action:hover { background: #f8fafc; }
    .china-link-action.is-primary { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; cursor: default; }
    .china-link-action:disabled { opacity: .45; cursor: not-allowed; }
    .china-link-status { font-size: 12px; font-weight: 800; color: #64748b; }
    .china-link-status.is-dirty { color: #b45309; }
    .china-link-status.is-error { color: #b91c1c; }
    .china-link-status.is-saved { color: #047857; }
    @media (max-width: 900px) {
      .china-link-row { grid-template-columns: 92px minmax(0, 1fr); }
      .china-link-action { grid-column: auto; }
    }
  `;
  document.head.append(style);
}

function scheduleRender() {
  clearRenderTimers();
  for (const delay of [0, 60, 180]) {
    renderTimers.push(window.setTimeout(() => renderCurrentItemLinks(), delay));
  }
}

function clearRenderTimers() {
  for (const timer of renderTimers) window.clearTimeout(timer);
  renderTimers = [];
}

function renderCurrentItemLinks() {
  if (!detailForm) return;
  const itemId = String(detailForm.elements?.id?.value ?? "").trim();
  if (!itemId) return;
  const state = readTrackerState();
  const item = findItem(state, itemId);
  if (!item) return;

  const section = ensureSection();
  if (!section) return;
  if (section.dataset.itemId === itemId && section.dataset.dirty === "true") return;
  if (section.dataset.itemId === itemId && section.dataset.initialized === "true") return;

  section.dataset.itemId = itemId;
  section.dataset.initialized = "true";
  section.dataset.dirty = "false";
  renderRows(readChinaProductLinks(item));

  const savedItem = sessionStorage.getItem(SAVED_ITEM_KEY);
  if (savedItem === itemId) {
    sessionStorage.removeItem(SAVED_ITEM_KEY);
    setStatus("중국 상품링크를 서버에 저장했습니다.", "saved");
  } else {
    setStatus(
      readChinaProductLinks(item).length
        ? "1번 링크가 상세페이지 엔진 기준 링크입니다."
        : "최대 5개까지 입력할 수 있습니다.",
    );
  }
}

function ensureSection() {
  let section = document.querySelector("#china-product-links-section");
  if (section) return section;
  const detailHtml = detailForm?.querySelector("textarea[name='detailHtml']");
  const detailPageSection = detailHtml?.closest("section.integration-section");
  if (!detailPageSection) return null;

  section = document.createElement("section");
  section.id = "china-product-links-section";
  section.className = "integration-section";
  section.innerHTML = `
    <div class="section-title-row">
      <div>
        <h3>중국 상품링크</h3>
        <p>최대 5개까지 저장합니다. 1번으로 고정한 링크를 상세페이지 엔진이 기준 링크로 읽습니다.</p>
      </div>
      <span id="china-product-links-status" class="china-link-status"></span>
    </div>
    <div id="china-product-links-list" class="china-link-list"></div>`;
  detailPageSection.before(section);

  section.addEventListener("input", (event) => {
    if (!event.target.closest("[data-china-link-input]")) return;
    section.dataset.dirty = "true";
    refreshRowActions();
    setStatus("저장 버튼을 눌러 반영하세요.", "dirty");
  });
  section.addEventListener("click", handleSectionClick);
  return section;
}

function handleSectionClick(event) {
  const button = event.target.closest("button[data-china-link-action]");
  if (!button) return;
  const action = button.dataset.chinaLinkAction;
  const index = Number(button.dataset.index);
  if (action === "pin") {
    try {
      const next = promoteChinaProductLink(readInputValues(), index);
      renderRows(next);
      const section = document.querySelector("#china-product-links-section");
      if (section) section.dataset.dirty = "true";
      setStatus("선택한 링크를 상세페이지 엔진용 1번으로 고정했습니다. 저장이 필요합니다.", "dirty");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "링크를 고정하지 못했습니다.", "error");
    }
    return;
  }
  if (action === "open") {
    try {
      const value = readInputValues()[index] ?? "";
      const url = normalizeChinaProductUrl(value);
      if (!url) throw new Error("열어볼 링크를 먼저 입력하세요.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "링크를 열지 못했습니다.", "error");
    }
  }
}

function renderRows(values) {
  const list = document.querySelector("#china-product-links-list");
  if (!list) return;
  const normalized = [...normalizeChinaProductLinks(values)];
  const padded = [
    ...normalized,
    ...Array(Math.max(0, MAX_CHINA_PRODUCT_LINKS - normalized.length)).fill(""),
  ].slice(0, MAX_CHINA_PRODUCT_LINKS);
  list.innerHTML = padded
    .map(
      (value, index) => `
        <div class="china-link-row" data-index="${index}">
          <span class="china-link-number ${index === 0 ? "is-primary" : ""}">
            ${index === 0 ? "1번 · 엔진 기준" : `${index + 1}번 링크`}
          </span>
          <input
            class="china-link-input"
            data-china-link-input
            data-index="${index}"
            type="url"
            inputmode="url"
            autocomplete="off"
            placeholder="https://detail.1688.com/offer/..."
            value="${escapeAttribute(value)}"
          />
          <button
            class="china-link-action"
            type="button"
            data-china-link-action="open"
            data-index="${index}"
            ${value ? "" : "disabled"}
          >열기</button>
          <button
            class="china-link-action ${index === 0 ? "is-primary" : ""}"
            type="button"
            data-china-link-action="pin"
            data-index="${index}"
            ${index === 0 ? "disabled" : ""}
          >${index === 0 ? "1번 고정됨" : "1번으로 고정"}</button>
        </div>`,
    )
    .join("");
  refreshRowActions();
}

function refreshRowActions() {
  const values = readInputValues();
  for (const button of document.querySelectorAll(
    "#china-product-links-list button[data-china-link-action='open']",
  )) {
    const index = Number(button.dataset.index);
    button.disabled = !String(values[index] ?? "").trim();
  }
}

function readInputValues() {
  return [
    ...document.querySelectorAll("#china-product-links-list [data-china-link-input]"),
  ].map((input) => input.value);
}

function validateBeforeSave(event) {
  pendingSave = null;
  if (event.submitter?.value !== "save") return;
  const itemId = String(detailForm?.elements?.id?.value ?? "").trim();
  if (!itemId) return;
  try {
    const links = normalizeChinaProductLinks(readInputValues());
    pendingSave = { itemId, links };
  } catch (error) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const message = error instanceof Error ? error.message : "중국 상품링크를 확인하세요.";
    setStatus(message, "error");
    window.alert(message);
  }
}

function persistAfterMainSave(event) {
  if (event.defaultPrevented || event.submitter?.value !== "save" || !pendingSave) {
    return;
  }
  const draft = pendingSave;
  pendingSave = null;
  window.setTimeout(() => void persistDraft(draft), 0);
}

async function persistDraft(draft) {
  const state = readTrackerState();
  const item = findItem(state, draft.itemId);
  if (!state || !item || sameChinaProductLinks(item, draft.links)) return;

  const now = new Date();
  const nextItem = applyChinaProductLinks(item, draft.links, {
    now,
    updatedBy: "승준",
  });
  const nextState = {
    ...state,
    savedAt: now.toISOString(),
    items: state.items.map((candidate) =>
      String(candidate?.id ?? "") === draft.itemId ? nextItem : candidate,
    ),
  };

  localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(nextState));
  try {
    const response = await fetch(TRACKER_STATE_ENDPOINT, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: nextState }),
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "중국 상품링크를 서버에 저장하지 못했습니다.");
    }
    sessionStorage.setItem(REOPEN_ITEM_KEY, draft.itemId);
    sessionStorage.setItem(SAVED_ITEM_KEY, draft.itemId);
    window.location.reload();
  } catch (error) {
    console.error(error);
    window.alert(
      error instanceof Error
        ? `${error.message}\n브라우저에는 저장됐습니다. 네트워크를 확인한 뒤 다시 저장하세요.`
        : "중국 상품링크를 서버에 저장하지 못했습니다.",
    );
  }
}

function scheduleReopenSavedItem() {
  const itemId = sessionStorage.getItem(REOPEN_ITEM_KEY);
  if (!itemId) return;
  for (const delay of [150, 450, 900]) {
    window.setTimeout(() => {
      const row = [...document.querySelectorAll("#launch-table-body tr[data-id]")].find(
        (candidate) => String(candidate.dataset.id ?? "") === itemId,
      );
      const button = row?.querySelector("button[data-action='detail']");
      if (!button) return;
      sessionStorage.removeItem(REOPEN_ITEM_KEY);
      button.click();
    }, delay);
  }
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRACKER_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" && Array.isArray(parsed.items)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function findItem(state, itemId) {
  return state?.items?.find(
    (candidate) => String(candidate?.id ?? "") === String(itemId),
  );
}

function setStatus(message, tone = "") {
  const element = document.querySelector("#china-product-links-status");
  if (!element) return;
  element.textContent = message;
  element.className = `china-link-status${tone ? ` is-${tone}` : ""}`;
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", " ");
}
