const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const JOB_DETAIL_PATH = /^\/api\/product-launch-tracker\/detail-page-jobs\/([^/]+)$/;
const FIELD_NAME = "detailPageProductScope";
const SCOPE_PREFIX = "SELLER-CONFIRMED SHIPMENT SCOPE (authoritative seller input)";

const originalFetch = window.fetch.bind(window);
let loadedItemId = "";
let pendingScopeSave = null;

installField();
installEvidenceScopeBridge();

function installField() {
  const form = document.querySelector("#detail-form");
  const dialog = document.querySelector("#detail-dialog");
  const title = document.querySelector("#detail-dialog-title");
  if (!form || !dialog) return;

  let field = form.elements?.[FIELD_NAME];
  if (!field) {
    const notes = form.querySelector("textarea[name='notes']")?.closest("label.field");
    const label = document.createElement("label");
    label.className = "field field-span-2";
    label.innerHTML = `
      <span>상세페이지 실제 발송구성 <small>선택 입력</small></span>
      <textarea name="${FIELD_NAME}" rows="2" placeholder="예: 내부 플라스틱 틀만 발송 / 메쉬천·파우치 미포함"></textarea>
      <small>대표·부가·상세페이지의 상품 본체·포함품 판정에 최우선으로 사용합니다. 중국 원본 사진만으로 구성품이 애매한 상품에만 입력하세요.</small>
    `;
    notes?.after(label);
    field = form.elements?.[FIELD_NAME];
  }

  const refreshScope = () => {
    if (!dialog.open) return;
    const itemId = String(form.elements?.id?.value || "").trim();
    if (!itemId || itemId === loadedItemId) return;
    loadedItemId = itemId;
    void loadScope(itemId, field);
  };

  if (title) {
    new MutationObserver(refreshScope).observe(title, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  new MutationObserver(refreshScope).observe(dialog, {
    attributes: true,
    attributeFilter: ["open"],
  });

  form.addEventListener("submit", (event) => {
    if (event.submitter?.value !== "save") return;
    const itemId = String(form.elements?.id?.value || "").trim();
    if (!itemId) return;
    pendingScopeSave = {
      itemId,
      value: String(field?.value || "").trim().slice(0, 1000),
    };
    window.setTimeout(() => void flushPendingScopeSave(), 800);
  });

  dialog.addEventListener("close", () => {
    loadedItemId = "";
    if (pendingScopeSave) window.setTimeout(() => void flushPendingScopeSave(), 100);
  });
}

async function loadScope(itemId, field) {
  try {
    const response = await originalFetch(
      `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !body.item) return;
    if (String(document.querySelector("#detail-form")?.elements?.id?.value || "") !== itemId) return;
    field.value = String(body.item[FIELD_NAME] || "");
  } catch (error) {
    console.warn("[detail-page-product-scope] load skipped", error);
  }
}

async function flushPendingScopeSave() {
  const pending = pendingScopeSave;
  if (!pending) return;
  pendingScopeSave = null;
  try {
    const response = await originalFetch(OPTIMIZED_API, {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "patch_item",
        itemId: pending.itemId,
        patch: { [FIELD_NAME]: pending.value },
        updatedBy: "승준",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "상세페이지 실제 발송구성을 저장하지 못했습니다.");
    }
  } catch (error) {
    console.error("[detail-page-product-scope] save failed", error);
  }
}

function installEvidenceScopeBridge() {
  window.fetch = async (input, init) => {
    const requestUrl = resolveUrl(input);
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const match = requestUrl?.pathname.match(JOB_DETAIL_PATH);
    if (method !== "POST" || !match || typeof init?.body !== "string") {
      return originalFetch(input, init);
    }

    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      return originalFetch(input, init);
    }
    if (body?.action !== "evidence_ready") return originalFetch(input, init);

    try {
      const jobId = decodeURIComponent(match[1]);
      const scope = await sellerScopeForJob(jobId);
      if (scope) {
        const originalSourceInfo = String(body.sourceProductInfo || "").trim();
        const scopeEvidence = [
          `${SCOPE_PREFIX}: ${scope}`,
          "This seller-entered shipment scope is authoritative for what is actually shipped. It overrides ambiguous visual context when deciding the sellable body, included components, and non-included props. Do not merge a stated non-included prop into the product body.",
        ].join("\n");
        body.sourceProductInfo = [originalSourceInfo, scopeEvidence]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 8000);
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch (error) {
      console.warn("[detail-page-product-scope] evidence bridge skipped", error);
    }
    return originalFetch(input, init);
  };
}

async function sellerScopeForJob(jobId) {
  const jobResponse = await originalFetch(
    `/api/product-launch-tracker/detail-page-jobs/${encodeURIComponent(jobId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  const jobBody = await jobResponse.json().catch(() => ({}));
  const itemId = String(jobBody?.job?.itemId || "").trim();
  if (!jobResponse.ok || jobBody?.ok !== true || !itemId) return "";

  const itemResponse = await originalFetch(
    `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  const itemBody = await itemResponse.json().catch(() => ({}));
  if (!itemResponse.ok || itemBody?.ok !== true || !itemBody.item) return "";
  return String(itemBody.item[FIELD_NAME] || "").trim().slice(0, 1000);
}

function resolveUrl(input) {
  try {
    const value = input instanceof Request ? input.url : String(input || "");
    return new URL(value, window.location.origin);
  } catch {
    return null;
  }
}
