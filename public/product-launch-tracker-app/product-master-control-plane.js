const PRODUCT_MASTER_CORE_API = "/api/product-launch-tracker/product-master-core";
const PRODUCT_MASTER_BASE_URL = "https://commerce-os-product-master.vercel.app";
const MASTER_FALLBACK_DELAY_MS = 3_000;
const MASTER_PAGE_SIZE = 25;
const MASTER_DISABLED_SELECTOR = [
  "#batch-filter",
  "#assignee-filter",
  "#overall-filter",
  "#unfinished-only-filter",
  "#bulk-stage",
  "#bulk-status",
  "#bulk-apply-button",
  "#clear-selection-button",
  "#select-visible",
  "#add-items-button",
  "#policy-button",
].join(",");

let livePageLoaded = false;
let masterFallbackActive = false;
let masterProducts = [];
let fallbackRequest = null;
let fallbackRenderGuard = false;
let defaultMasterViewApplied = false;

upgradePageIdentity();
installProductMasterDetailLink();
installFallbackObserver();
scheduleMasterFallback();

window.addEventListener("product-launch-tracker:page-loaded", () => {
  livePageLoaded = true;
  deactivateMasterFallback();
  applyDefaultMasterView();
});

function upgradePageIdentity() {
  document.title = "상품마스터 · 출시관리";
  const title = document.querySelector(".topbar h1");
  if (title) title.textContent = "상품마스터 · 출시관리";
  const subtitle = document.querySelector(".topbar .subtitle");
  if (subtitle) {
    subtitle.textContent =
      "상품 핵심 원장은 Product Master에서 보호하고, 상세페이지·키워드·샵플링·재고 등 출시 Workflow를 한 화면에서 관리합니다.";
  }
  const notice = document.querySelector("main .notice strong");
  if (notice) {
    notice.textContent =
      "이 화면을 Commerce OS 상품마스터 메인 UI로 사용합니다. 상품 핵심 원장과 OPS 실행상태는 분리되어 장애가 서로 전파되지 않도록 운영합니다.";
  }
}

function installProductMasterDetailLink() {
  const detailForm = document.querySelector("#detail-form");
  const previewButton = document.querySelector("#preview-button");
  if (!detailForm || !previewButton || document.querySelector("#product-master-core-button")) return;

  const button = document.createElement("button");
  button.id = "product-master-core-button";
  button.className = "button button-secondary";
  button.type = "button";
  button.textContent = "상품마스터에서 이 상품 핵심 원장 확인하기";
  previewButton.insertAdjacentElement("beforebegin", button);
  button.addEventListener("click", () => {
    const model = normalizeModelNumber(detailForm.elements?.modelNumber?.value);
    if (!model) {
      window.alert("상품마스터 핵심 원장을 열려면 정확한 AAA 모델번호가 필요합니다.");
      return;
    }
    window.open(productMasterCoreUrl(model), "_blank", "noopener,noreferrer");
  });
}

function installFallbackObserver() {
  const status = document.querySelector("#save-status");
  const body = document.querySelector("#launch-table-body");
  if (!status || !body) return;

  const observer = new MutationObserver(() => {
    if (livePageLoaded) return;
    const statusText = status.textContent || "";
    const bodyText = body.textContent || "";
    if (
      statusText.includes("목록 불러오기 실패") ||
      statusText.includes("목록 응답 지연") ||
      bodyText.includes("목록을 불러오지 못했습니다")
    ) {
      void ensureMasterFallback();
    }
    if (masterFallbackActive && !fallbackRenderGuard && bodyText.includes("목록을 불러오지 못했습니다")) {
      renderMasterFallback();
    }
  });
  observer.observe(status, { childList: true, subtree: true, characterData: true });
  observer.observe(body, { childList: true, subtree: true });
}

function scheduleMasterFallback() {
  window.setTimeout(() => {
    if (!livePageLoaded) void ensureMasterFallback();
  }, MASTER_FALLBACK_DELAY_MS);
}

async function ensureMasterFallback() {
  if (livePageLoaded || masterFallbackActive) return;
  if (!fallbackRequest) {
    fallbackRequest = fetch(PRODUCT_MASTER_CORE_API, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.products)) {
          throw new Error(payload?.message || `Product Master 응답 오류 (${response.status})`);
        }
        return payload;
      })
      .finally(() => {
        fallbackRequest = null;
      });
  }

  try {
    const payload = await fallbackRequest;
    if (livePageLoaded) return;
    masterProducts = payload.products;
    masterFallbackActive = true;
    document.body.dataset.productMasterFallback = "true";
    lockWorkflowWrites(true);
    renderMasterFallback();
    const search = document.querySelector("#search-input");
    if (search && search.dataset.masterFallbackBound !== "true") {
      search.dataset.masterFallbackBound = "true";
      search.addEventListener("input", () => {
        if (masterFallbackActive) renderMasterFallback();
      });
    }
  } catch (error) {
    console.error("Product Master fallback failed", error);
  }
}

function renderMasterFallback() {
  if (!masterFallbackActive || livePageLoaded) return;
  const body = document.querySelector("#launch-table-body");
  if (!body) return;
  const search = String(document.querySelector("#search-input")?.value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  const filtered = masterProducts.filter((product) => {
    if (!search) return true;
    return [
      product.modelNumber,
      product.productName,
      ...(product.barcodes || []),
      ...(product.optionLabels || []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
  const visible = filtered.slice(0, MASTER_PAGE_SIZE);

  fallbackRenderGuard = true;
  body.innerHTML = visible.map(renderMasterRow).join("");
  fallbackRenderGuard = false;
  body.dataset.masterFallback = "true";

  const status = document.querySelector("#save-status");
  if (status) {
    status.textContent = "Product Master 핵심 원장 표시 · OPS Workflow 재연결 대기";
    status.dataset.tone = "warning";
  }
  const visibleCount = document.querySelector("#visible-count");
  if (visibleCount) {
    visibleCount.textContent = `${formatNumber(filtered.length)}개 상품 · 핵심 원장 임시 보기`;
  }
  const selectedCount = document.querySelector("#selected-count");
  if (selectedCount) selectedCount.textContent = "읽기 전용";
  const sourceMeta = document.querySelector("#source-meta");
  if (sourceMeta) sourceMeta.textContent = "Product Master 독립 원장 · OPS 작업상태 연결 대기";

  renderMasterSummary(filtered);
  bindMasterRowButtons();
}

function renderMasterSummary(products) {
  const summary = document.querySelector("#summary");
  if (!summary) return;
  const skuCount = products.reduce(
    (sum, product) => sum + (Array.isArray(product.options) ? product.options.length : 0),
    0,
  );
  const withOptions = products.filter((product) => (product.options || []).length > 1).length;
  summary.innerHTML = [
    ["핵심 원장 상품", products.length],
    ["활성 SKU", skuCount],
    ["복수 옵션 상품", withOptions],
    ["OPS Workflow", "연결 대기"],
  ]
    .map(
      ([label, value]) =>
        `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong></article>`,
    )
    .join("");
}

function renderMasterRow(product, index) {
  const barcodes = Array.isArray(product.barcodes) ? product.barcodes : [];
  const options = Array.isArray(product.optionLabels) ? product.optionLabels : [];
  const barcodeCell = barcodes.length > 1
    ? `<div class="inline-option-location-list"><div class="inline-option-location-title">B-code</div>${barcodes.map((barcode) => `<div class="inline-option-location-row"><strong>${escapeHtml(barcode)}</strong></div>`).join("")}</div>`
    : `<strong>${escapeHtml(barcodes[0] || "미등록")}</strong>`;
  const pendingCell = '<td><span class="status-select" style="display:inline-flex;align-items:center;justify-content:center;min-width:72px;pointer-events:none">연결 대기</span></td>';
  return `
    <tr data-master-model="${escapeAttribute(product.modelNumber)}" class="master-core-fallback-row">
      <td class="check-column"><input type="checkbox" disabled aria-label="읽기 전용" /></td>
      <td class="cell-truncate"><span class="optimized-row-number">#M${index + 1}</span>상품마스터</td>
      <td>${barcodeCell}</td>
      <td><strong>${escapeHtml(product.modelNumber)}</strong></td>
      <td class="product-name"><strong>${escapeHtml(product.productName)}</strong></td>
      <td><span class="sync-status">핵심 원장</span></td>
      <td>${escapeHtml(options.join(", ") || "단품")}</td>
      <td><span class="readiness-badge is-ready">원장 확인</span></td>
      ${pendingCell}${pendingCell}${pendingCell}${pendingCell}${pendingCell}${pendingCell}
      <td class="next-stage">OPS 재연결<span class="progress-text">핵심 원장은 정상</span></td>
      <td class="row-actions"><button class="row-action" type="button" data-master-core-model="${escapeAttribute(product.modelNumber)}">핵심 원장</button></td>
    </tr>`;
}

function bindMasterRowButtons() {
  for (const button of document.querySelectorAll("button[data-master-core-model]")) {
    if (button.dataset.masterBound === "true") continue;
    button.dataset.masterBound = "true";
    button.addEventListener("click", () => {
      const model = normalizeModelNumber(button.dataset.masterCoreModel);
      if (model) window.open(productMasterCoreUrl(model), "_blank", "noopener,noreferrer");
    });
  }
}

function lockWorkflowWrites(locked) {
  for (const element of document.querySelectorAll(MASTER_DISABLED_SELECTOR)) {
    if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) continue;
    if (locked) {
      if (!element.disabled) element.dataset.masterFallbackDisabled = "true";
      element.disabled = true;
    } else if (element.dataset.masterFallbackDisabled === "true") {
      element.disabled = false;
      delete element.dataset.masterFallbackDisabled;
    }
  }
}

function deactivateMasterFallback() {
  if (!masterFallbackActive) return;
  masterFallbackActive = false;
  delete document.body.dataset.productMasterFallback;
  lockWorkflowWrites(false);
}

function applyDefaultMasterView() {
  if (defaultMasterViewApplied) return;
  defaultMasterViewApplied = true;
  const unfinished = document.querySelector("#unfinished-only-filter");
  if (!(unfinished instanceof HTMLInputElement) || !unfinished.checked) return;
  unfinished.checked = false;
  unfinished.dispatchEvent(new Event("change", { bubbles: true }));
}

function productMasterCoreUrl(model) {
  return `${PRODUCT_MASTER_BASE_URL}/core/${encodeURIComponent(model)}`;
}

function normalizeModelNumber(value) {
  const candidate = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  const match = candidate.match(/^AAA0*(\d+)$/);
  if (!match) return /^AAA\d{3,}$/.test(candidate) ? candidate : "";
  return `AAA${match[1].padStart(3, "0")}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
