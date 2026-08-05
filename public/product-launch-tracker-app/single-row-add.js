import {
  createLaunchItem,
  generateUniqueSelfCode,
  normalizeBarcode,
  normalizeModelNumber,
} from "./lib/tracker-core.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";
const DIALOG_ID = "single-row-add-dialog";
const BUTTON_ID = "add-single-row-button";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installSingleRowAdd();
}

export function parseSingleRowList(value) {
  return String(value ?? "")
    .split(/[,\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function nextTrackerRowNumber(itemsInput) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  const rows = items.flatMap((item) => {
    const explicit = positiveInteger(item?.trackerRowNumber);
    const sourceRows = Array.isArray(item?.source?.rows)
      ? item.source.rows.map(positiveInteger).filter((value) => value !== null)
      : [];
    return explicit === null ? sourceRows : [explicit, ...sourceRows];
  });
  return Math.max(0, ...rows) + 1;
}

export function buildSingleRowOrderOptions(input) {
  const optionValues = parseSingleRowList(input?.options);
  const values = optionValues.length ? optionValues : ["단품"];
  const rawCodes = String(input?.optionBarcodes ?? "")
    .split(/[,\n]/)
    .map((entry) => normalizeBarcode(entry));
  while (rawCodes.length && rawCodes.at(-1) === "") rawCodes.pop();
  if (rawCodes.length > values.length) {
    throw new Error("옵션별 위치코드 수가 옵션 수보다 많습니다.");
  }

  const inputMainBarcode = normalizeBarcode(input?.barcode);
  const singleBarcode = values.length === 1
    ? rawCodes[0] || inputMainBarcode
    : "";
  const barcode = inputMainBarcode || singleBarcode;
  const optionName = String(input?.optionName ?? "옵션").trim() || "옵션";
  const orderOptions = values.map((saleOption, index) => ({
    id: `direct-option-${index + 1}`,
    optionName,
    saleOption,
    chinaOption: "",
    barcode:
      values.length === 1
        ? singleBarcode
        : rawCodes[index] || "",
    baseSalePriceKrw: 0,
    unitCostKrw: 0,
    sourceOrderItemId: null,
  }));

  return { barcode, orderOptions };
}

export function buildSingleRowTrackerState(
  storedState,
  input,
  now = new Date().toISOString(),
  dependencies = {},
) {
  if (!storedState || typeof storedState !== "object" || Array.isArray(storedState)) {
    return { ok: false, message: "저장된 상품출시진행관리 데이터를 찾지 못했습니다." };
  }
  const items = Array.isArray(storedState.items) ? storedState.items : [];
  const modelNumber = normalizeModelNumber(input?.modelNumber);
  const productName = String(input?.productName ?? "").trim();
  if (!modelNumber) return { ok: false, message: "모델번호를 입력하세요." };
  if (!productName) return { ok: false, message: "모델명을 입력하세요." };
  if (
    items.some(
      (item) => normalizeModelNumber(item?.modelNumber) === modelNumber,
    )
  ) {
    return { ok: false, message: `${modelNumber} 모델번호가 이미 존재합니다.` };
  }

  let optionResult;
  try {
    optionResult = buildSingleRowOrderOptions(input);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "옵션 입력값이 올바르지 않습니다.",
    };
  }

  const trackerRowNumber = nextTrackerRowNumber(items);
  const usedCodes = new Set(
    items.map((item) => String(item?.selfCodeBase ?? "").trim()).filter(Boolean),
  );
  const codeFactory =
    dependencies.codeFactory ??
    ((used) => generateUniqueSelfCode(used));
  const idFactory =
    dependencies.idFactory ??
    (() => crypto.randomUUID());
  const selfCodeBase = codeFactory(usedCodes);
  const item = createLaunchItem(
    {
      workBatch: String(input?.workBatch ?? "").trim() || "신규 입고",
      warehouseLocation: String(input?.warehouseLocation ?? "").trim(),
      barcode: optionResult.barcode,
      modelNumber,
      productName,
      shoplingCategory: String(input?.shoplingCategory ?? "").trim(),
      selfCodeBase,
      orderOptions: optionResult.orderOptions,
      notes: String(input?.notes ?? "").trim(),
      sourceFile: "상품출시진행관리 행 추가",
      sourceRows: [],
      updatedBy: "승준",
    },
    idFactory,
  );
  item.trackerRowNumber = trackerRowNumber;
  item.createdAt = now;
  item.updatedAt = now;

  return {
    ok: true,
    item,
    state: {
      ...storedState,
      schemaVersion: Math.max(3, Number(storedState.schemaVersion) || 3),
      savedAt: now,
      items: [...items, item],
    },
  };
}

function installSingleRowAdd() {
  if (window.__commerceOsSingleRowAddInstalled) return;
  window.__commerceOsSingleRowAddInstalled = true;
  installStyles();
  const dialog = createDialog();
  const button = installButton();
  if (!dialog || !button) return;

  button.addEventListener("click", () => openDialog(dialog));
  const form = dialog.querySelector("form");
  form?.addEventListener("submit", (event) => handleSubmit(event, dialog));
  form?.elements?.options?.addEventListener("input", () => refreshOptionHelp(form));
  form?.elements?.optionBarcodes?.addEventListener("input", () => refreshOptionHelp(form));
}

function installButton() {
  const existing = document.querySelector("#add-items-button");
  if (!(existing instanceof HTMLButtonElement)) return null;
  const current = document.querySelector(`#${BUTTON_ID}`);
  if (current instanceof HTMLButtonElement) return current;

  existing.textContent = "여러 행 붙여넣기";
  existing.classList.remove("button-primary");
  existing.classList.add("button-secondary");

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "button button-primary";
  button.textContent = "+ 행 추가";
  button.title = "새로 들어온 상품을 한 행씩 직접 입력합니다.";
  existing.before(button);
  return button;
}

function createDialog() {
  const current = document.querySelector(`#${DIALOG_ID}`);
  if (current instanceof HTMLDialogElement) return current;
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "dialog dialog-wide";
  dialog.innerHTML = `
    <form method="dialog" class="single-row-add-form">
      <div class="dialog-header">
        <div>
          <p class="eyebrow">신규 상품 입력</p>
          <h2>상품 행 추가</h2>
        </div>
        <button class="icon-button" value="cancel" aria-label="닫기">×</button>
      </div>
      <p class="dialog-description">
        새로 들어온 상품의 기본정보를 입력합니다. 저장 후 표에서 옵션·가격·상세페이지 정보를 계속 보완할 수 있습니다.
      </p>
      <div class="form-grid">
        <label class="field">
          <span>작업 묶음</span>
          <input name="workBatch" value="신규 입고" autocomplete="off" />
        </label>
        <label class="field">
          <span>기준바코드 <small>위치코드</small></span>
          <input name="barcode" placeholder="예: BAA1-1" autocomplete="off" />
        </label>
        <label class="field">
          <span>모델번호 <strong class="required-mark">필수</strong></span>
          <input name="modelNumber" placeholder="예: AAA500" autocomplete="off" required />
        </label>
        <label class="field field-span-2">
          <span>모델명 <strong class="required-mark">필수</strong></span>
          <input name="productName" placeholder="상품명을 입력하세요" autocomplete="off" required />
        </label>
        <label class="field field-span-2">
          <span>샵플링 표준 카테고리</span>
          <input name="shoplingCategory" placeholder="나중에 입력해도 됩니다" autocomplete="off" />
        </label>
        <label class="field">
          <span>옵션명</span>
          <input name="optionName" value="옵션" autocomplete="off" />
        </label>
        <label class="field field-span-2">
          <span>옵션값 <small>쉼표 또는 줄바꿈 구분</small></span>
          <textarea name="options" rows="3" placeholder="단품 또는 화이트, 블랙">단품</textarea>
        </label>
        <label class="field field-span-2">
          <span>옵션별 위치코드 <small>옵션 순서대로 입력</small></span>
          <textarea name="optionBarcodes" rows="3" placeholder="단품은 비워도 기준바코드를 사용합니다. 다옵션 예: BAA1-1, BAA1-2"></textarea>
          <small id="single-row-option-help">옵션 1개 · 기준바코드를 옵션 바코드와 옵션자체관리코드에 동일 사용합니다.</small>
        </label>
        <label class="field">
          <span>창고위치 <small>선택</small></span>
          <input name="warehouseLocation" autocomplete="off" />
        </label>
        <label class="field field-span-2">
          <span>비고</span>
          <textarea name="notes" rows="3"></textarea>
        </label>
      </div>
      <div class="dialog-actions">
        <span class="single-row-add-note">새 행번호와 자사상품코드는 자동 생성됩니다.</span>
        <div class="dialog-actions-right">
          <button class="button button-ghost" value="cancel">취소</button>
          <button class="button button-primary" type="submit" value="save">행 추가</button>
        </div>
      </div>
    </form>`;
  document.body.append(dialog);
  return dialog;
}

function openDialog(dialog) {
  const form = dialog.querySelector("form");
  form?.reset();
  if (form?.elements?.workBatch) form.elements.workBatch.value = "신규 입고";
  if (form?.elements?.optionName) form.elements.optionName.value = "옵션";
  if (form?.elements?.options) form.elements.options.value = "단품";
  refreshOptionHelp(form);
  dialog.showModal();
  window.setTimeout(() => form?.elements?.modelNumber?.focus(), 0);
}

function refreshOptionHelp(form) {
  const help = document.querySelector("#single-row-option-help");
  if (!help || !form) return;
  const options = parseSingleRowList(form.elements.options?.value);
  const count = options.length || 1;
  help.textContent =
    count === 1
      ? "옵션 1개 · 기준바코드를 옵션 바코드와 옵션자체관리코드에 동일 사용합니다."
      : `옵션 ${count}개 · 각 옵션 순서에 맞는 위치코드를 각각 입력하세요.`;
}

function handleSubmit(event, dialog) {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const form = event.currentTarget;
  const storedState = readStoredState();
  const input = Object.fromEntries(new FormData(form));
  const result = buildSingleRowTrackerState(storedState, input);
  if (!result.ok) {
    showToast(result.message);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state));
  window.dispatchEvent(
    new CustomEvent(EXTERNAL_STATE_EVENT, {
      detail: {
        typingGuardBypass: true,
        source: "single-row-add",
        itemId: result.item.id,
      },
    }),
  );
  dialog.close();
  showToast(
    `${result.item.trackerRowNumber}행 · ${result.item.modelNumber} ${result.item.productName}을 추가했습니다.`,
  );
  window.setTimeout(() => highlightAddedRow(result.item.id), 120);
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function highlightAddedRow(itemId) {
  const row = [...document.querySelectorAll("#launch-table-body tr[data-id]")].find(
    (candidate) => String(candidate.dataset.id ?? "") === itemId,
  );
  if (!row) return;
  row.classList.add("single-row-added-highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => row.classList.remove("single-row-added-highlight"), 2200);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function installStyles() {
  if (document.querySelector("#single-row-add-styles")) return;
  const style = document.createElement("style");
  style.id = "single-row-add-styles";
  style.textContent = `
    #${DIALOG_ID} .required-mark {
      margin-left: 4px;
      color: #dc2626;
      font-size: 11px;
    }
    #${DIALOG_ID} .single-row-add-note {
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }
    #${DIALOG_ID} .field small {
      display: block;
      margin-top: 5px;
      color: #64748b;
      line-height: 1.5;
    }
    tr.single-row-added-highlight td {
      animation: single-row-added-flash 2.2s ease-out;
    }
    @keyframes single-row-added-flash {
      0%, 35% { background: #dcfce7; }
      100% { background: inherit; }
    }
  `;
  document.head.append(style);
}

let toastTimer;
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) {
    window.alert(message);
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}
