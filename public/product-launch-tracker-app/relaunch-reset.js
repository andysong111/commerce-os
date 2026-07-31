import {
  PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
  PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY,
} from "./lib/product-launch-flow-handoff.mjs";
import {
  canResetForRelaunch,
  resetLaunchItemForRelaunch,
} from "./lib/relaunch-reset.mjs";

const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");

if (detailDialog && detailForm) {
  const observer = new MutationObserver(() => decorateCurrentDetail());
  observer.observe(detailDialog, { childList: true, subtree: true });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button[data-action='detail']")) {
        window.setTimeout(() => decorateCurrentDetail(), 0);
      }
    },
    true,
  );

  detailDialog.addEventListener("close", () => {
    document.querySelector("#relaunch-reset-history-panel")?.remove();
  });
}

function decorateCurrentDetail() {
  const itemId = String(detailForm?.elements?.id?.value ?? "").trim();
  if (!itemId) return;
  const state = readTrackerState();
  const item = findItem(state, itemId);
  if (!item) return;

  renderResetHistory(item);
  if (!canResetForRelaunch(item)) return;

  const resultPanel = document.querySelector(
    "#shopling-registration-result-panel",
  );
  const titleRow = resultPanel?.querySelector(".section-title-row");
  if (!titleRow || titleRow.querySelector("[data-relaunch-reset-button]")) {
    return;
  }

  const actionWrap = document.createElement("div");
  actionWrap.style.display = "flex";
  actionWrap.style.flexDirection = "column";
  actionWrap.style.alignItems = "flex-end";
  actionWrap.style.gap = "6px";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-ghost";
  button.dataset.relaunchResetButton = "true";
  button.textContent = "재출시 초기화";
  button.style.borderColor = "#ef4444";
  button.style.color = "#b91c1c";
  button.title =
    "기존 goods_key는 이력으로 보존하고 새 자사상품코드로 다시 출시합니다.";
  button.addEventListener("click", () => void resetForRelaunch(button, itemId));

  const help = document.createElement("span");
  help.textContent = "샵플링에서 기존 상품을 삭제한 경우에만 사용";
  help.style.fontSize = "11px";
  help.style.fontWeight = "700";
  help.style.color = "#991b1b";

  actionWrap.append(button, help);
  titleRow.append(actionWrap);
}

async function resetForRelaunch(button, itemId) {
  const state = readTrackerState();
  const item = findItem(state, itemId);
  if (!state || !item) {
    window.alert("재출시 초기화할 상품 데이터를 찾지 못했습니다.");
    return;
  }

  const modelNumber = String(item.modelNumber ?? "").trim();
  const confirmation = window.prompt(
    [
      `${modelNumber} 상품을 재출시 초기화합니다.`,
      "",
      "· 기존 goods_key 6개는 재출시 이력에 보존",
      "· 새 자사상품코드 자동 생성",
      "· 상세페이지·옵션·원가·카테고리 데이터는 유지",
      "· 모든 출시 단계는 미시작으로 초기화",
      "",
      "샵플링에서 기존 상품을 삭제하지 않았다면 중복 상품이 생길 수 있습니다.",
      `계속하려면 모델번호 ${modelNumber}를 입력하세요.`,
    ].join("\n"),
  );
  if (String(confirmation ?? "").trim().toUpperCase() !== modelNumber.toUpperCase()) {
    return;
  }

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "초기화 중...";
  try {
    const now = new Date();
    const nextItem = resetLaunchItemForRelaunch(item, state.items, {
      now,
      resetBy: "승준",
      reason: "샵플링 상품 수동 삭제 후 재출시 초기화",
    });
    const nextState = {
      ...state,
      items: state.items.map((candidate) =>
        String(candidate?.id ?? "") === itemId ? nextItem : candidate,
      ),
      savedAt: now.toISOString(),
    };

    await saveTrackerState(nextState);
    window.localStorage.setItem(
      TRACKER_STORAGE_KEY,
      JSON.stringify(nextState),
    );
    clearRelatedProductLaunchFlow(itemId, modelNumber);

    window.alert(
      `${modelNumber} 재출시 초기화가 완료됐습니다.\n새 자사상품코드: ${nextItem.selfCodeBase}\n상품정보를 수정한 뒤 처음부터 다시 출시하세요.`,
    );
    window.location.reload();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = previousText;
    window.alert(
      error instanceof Error
        ? error.message
        : "재출시 초기화를 완료하지 못했습니다.",
    );
  }
}

async function saveTrackerState(state) {
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      body?.message || "재출시 초기화 상태를 서버에 저장하지 못했습니다.",
    );
  }
}

function clearRelatedProductLaunchFlow(itemId, modelNumber) {
  const handoff = readJson(PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY);
  const session = readJson(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY);
  const handoffMatches = String(handoff?.itemId ?? "") === itemId;
  const sessionMatches =
    String(session?.rowExpression ?? "") === `진행관리:${modelNumber}`;
  if (handoffMatches) {
    window.localStorage.removeItem(PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY);
  }
  if (handoffMatches || sessionMatches) {
    window.localStorage.removeItem(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY);
  }
}

function renderResetHistory(item) {
  document.querySelector("#relaunch-reset-history-panel")?.remove();
  const history = Array.isArray(item.registrationResetHistory)
    ? item.registrationResetHistory
    : [];
  if (!history.length) return;

  const anchor = document.querySelector("#detail-stages");
  if (!anchor) return;
  const latest = history[history.length - 1] ?? {};
  const products = latest.previousProducts ?? {};
  const goodsKeys = Object.values(products)
    .map((product) => String(product?.goodsKey ?? "").trim())
    .filter(Boolean);

  const section = document.createElement("section");
  section.id = "relaunch-reset-history-panel";
  section.className = "integration-section";
  section.innerHTML = `
    <div class="section-title-row">
      <div>
        <h3>재출시 초기화 이력</h3>
        <p>총 ${history.length}회 · 최근 초기화 ${escapeHtml(formatDateTime(latest.resetAt))}</p>
      </div>
    </div>
    <div class="source-history">
      이전 자사상품코드: <strong>${escapeHtml(latest.previousSelfCodeBase || "-")}</strong><br />
      이전 goods_key: ${goodsKeys.length ? goodsKeys.map(escapeHtml).join(", ") : "없음"}<br />
      사유: ${escapeHtml(latest.reason || "-")}
    </div>`;
  anchor.before(section);
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TRACKER_STORAGE_KEY) ?? "null",
    );
    return parsed && typeof parsed === "object" && Array.isArray(parsed.items)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function findItem(state, itemId) {
  return state?.items?.find(
    (candidate) => String(candidate?.id ?? "") === itemId,
  );
}

function readJson(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "-");
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
