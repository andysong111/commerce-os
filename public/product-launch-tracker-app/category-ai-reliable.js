const AI_BUTTON_ID = "shopling-category-ai-button";
const REVIEW_LINK_ID = "shopling-category-review-queue-link";
const STATUS_ID = "shopling-category-ai-run-status";
const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const AI_ENDPOINT = "/api/product-launch-tracker/ai-category";
const AI_TIMEOUT_MS = 55_000;
const STATE_TIMEOUT_MS = 20_000;
let analysisActive = false;
let activeController = null;

installReliableAiCategoryRunner();

function installReliableAiCategoryRunner() {
  document.addEventListener("click", interceptAiClick, true);
  document.addEventListener("click", guardReviewNavigation, true);
  window.addEventListener("beforeunload", guardPageLeave);
  window.setTimeout(resetStaleAiButton, 400);
}

function interceptAiClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(`#${AI_BUTTON_ID}`);
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (analysisActive) return;
  void runReliableAiCategoryAssignment(button);
}

function guardReviewNavigation(event) {
  if (!analysisActive) return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest(`#${REVIEW_LINK_ID}`);
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  window.alert("AI 카테고리 분석 결과를 저장 중입니다. 완료 후 검토함으로 이동하세요.");
}

function guardPageLeave(event) {
  if (!analysisActive) return;
  event.preventDefault();
  event.returnValue = "";
}

async function runReliableAiCategoryAssignment(button) {
  const ids = selectedItemIds();
  if (!ids.length) {
    window.alert("AI 카테고리를 설정할 상품을 먼저 체크하세요.");
    return;
  }
  if (ids.length > 25) {
    window.alert("AI 카테고리는 한 번에 최대 25개까지 처리합니다.");
    return;
  }

  const displayedState = readLocalState();
  if (!displayedState) {
    window.alert("신규 상품 출시 진행관리 저장본을 찾지 못했습니다.");
    return;
  }
  const selected = ids
    .map((id) => displayedState.items.find((item) => String(item?.id ?? "") === id))
    .filter(Boolean);
  if (selected.length !== ids.length) {
    window.alert("선택한 상품 일부를 저장본에서 찾지 못했습니다. 화면을 새로고침한 뒤 다시 실행하세요.");
    return;
  }

  analysisActive = true;
  activeController = new AbortController();
  setBusyUi(button, selected.length, true);
  setRunStatus("running", `1/3 · ${selected.length}건의 모델명·옵션을 AI가 분석하고 있습니다.`);

  try {
    const aiResponse = await fetchJsonWithTimeout(
      AI_ENDPOINT,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          items: selected.map((item) => ({
            itemId: item.id,
            modelNumber: item.modelNumber,
            productName: item.productName,
            optionLabels: Array.isArray(item.orderOptions)
              ? item.orderOptions.map((option) => option?.saleOption).filter(Boolean)
              : [],
            currentCategory: item.shoplingCategory || "",
            chinaProductLinks: Array.isArray(item.chinaProductLinks)
              ? item.chinaProductLinks
              : [],
          })),
        }),
        signal: activeController.signal,
      },
      AI_TIMEOUT_MS,
      "AI 카테고리 분석 시간이 55초를 초과했습니다.",
    );
    if (aiResponse?.ok !== true || !Array.isArray(aiResponse.results)) {
      throw new Error(aiResponse?.message || "AI 카테고리 결과를 받지 못했습니다.");
    }

    const autoCount = aiResponse.results.filter((result) => result.autoApply).length;
    const reviewCount = aiResponse.results.filter(
      (result) => !result.autoApply && !result.skippedExisting,
    ).length;
    const existingCount = aiResponse.results.filter((result) => result.skippedExisting).length;
    setRunStatus(
      "running",
      `2/3 · 분석 완료. 자동입력 ${autoCount}건, 검토함 ${reviewCount}건을 서버에 저장하고 있습니다.`,
    );

    const latestState = (await readServerState().catch(() => null)) || displayedState;
    const resultById = new Map(
      aiResponse.results.map((result) => [String(result.itemId), result]),
    );
    const now = new Date().toISOString();
    const nextState = {
      ...latestState,
      savedAt: now,
      items: latestState.items.map((item) => {
        const result = resultById.get(String(item?.id ?? ""));
        if (!result) return item;
        return {
          ...item,
          shoplingCategory: result.autoApply
            ? result.selectedPath
            : item.shoplingCategory,
          categoryAiSuggestion: result.selectedPath,
          categoryAiConfidence: result.confidence,
          categoryAiReason: result.reason,
          categoryAiAlternatives: result.alternatives,
          categoryAiCandidateChoices: Array.isArray(result.candidateChoices)
            ? result.candidateChoices
            : [],
          categoryAiCandidatePaths: Array.isArray(result.candidatePaths)
            ? result.candidatePaths
            : [],
          categoryAiStatus: result.autoApply
            ? "auto_applied"
            : result.skippedExisting
              ? "existing_preserved"
              : "review_required",
          categoryAiSnapshotHash: aiResponse.snapshot?.hash || "",
          categoryAiUpdatedAt: now,
          updatedAt: now,
          updatedBy: result.autoApply ? "AI 카테고리 자동설정" : item.updatedBy,
        };
      }),
    };

    await saveServerState(nextState);
    const serialized = JSON.stringify(nextState);
    localStorage.setItem(STORAGE_KEY, serialized);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: serialized,
        storageArea: localStorage,
      }),
    );
    updateReviewLinkCount(nextState);
    setRunStatus(
      "success",
      `3/3 · 저장 완료. 자동입력 ${autoCount}건 · 검토함 ${reviewCount}건 · 기존값 유지 ${existingCount}건`,
    );
    window.alert(
      `AI 카테고리 처리가 완료됐습니다.\n자동입력 ${autoCount}건 · 검토 필요 ${reviewCount}건 · 기존값 유지 ${existingCount}건`,
    );
    window.location.reload();
  } catch (error) {
    const message = readableError(error);
    setRunStatus("failed", message);
    window.alert(message);
  } finally {
    analysisActive = false;
    activeController = null;
    setBusyUi(button, selectedItemIds().length, false);
  }
}

function selectedItemIds() {
  return [...document.querySelectorAll("#launch-table-body tr[data-id]")]
    .filter((row) => row.querySelector("input[type='checkbox']:checked"))
    .map((row) => String(row.dataset.id ?? "").trim())
    .filter(Boolean);
}

function readLocalState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && Array.isArray(value.items) ? value : null;
  } catch {
    return null;
  }
}

async function readServerState() {
  const body = await fetchJsonWithTimeout(
    STATE_ENDPOINT,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    },
    STATE_TIMEOUT_MS,
    "최신 진행관리 데이터를 불러오는 시간이 초과됐습니다.",
  );
  if (body?.ok !== true || !body.state || !Array.isArray(body.state.items)) {
    throw new Error(body?.message || "최신 진행관리 데이터를 불러오지 못했습니다.");
  }
  return body.state;
}

async function saveServerState(state) {
  const body = await fetchJsonWithTimeout(
    STATE_ENDPOINT,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ state }),
    },
    STATE_TIMEOUT_MS,
    "AI 결과를 서버에 저장하는 시간이 초과됐습니다.",
  );
  if (body?.ok !== true) {
    throw new Error(body?.message || "AI 카테고리 결과를 서버에 저장하지 못했습니다.");
  }
}

async function fetchJsonWithTimeout(url, init, timeoutMs, timeoutMessage) {
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const signals = [init.signal, timeoutController.signal].filter(Boolean);
  const combinedSignal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any(signals)
      : timeoutController.signal;
  try {
    const response = await fetch(url, { ...init, signal: combinedSignal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.message || `요청에 실패했습니다. HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    if (timeoutController.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function setBusyUi(button, count, busy) {
  button.disabled = busy || count === 0;
  button.dataset.reliableAiBusy = busy ? "1" : "0";
  button.textContent = busy
    ? `${count}건 AI 분석 중…`
    : count
      ? `선택 AI 카테고리 자동설정 (${count}건)`
      : "선택 AI 카테고리 자동설정";
  const link = document.querySelector(`#${REVIEW_LINK_ID}`);
  if (link instanceof HTMLElement) {
    link.setAttribute("aria-disabled", busy ? "true" : "false");
    link.style.pointerEvents = busy ? "none" : "";
    link.style.opacity = busy ? "0.55" : "";
  }
}

function setRunStatus(tone, message) {
  const status = ensureRunStatus();
  status.dataset.tone = tone;
  status.textContent = message;
  status.style.color =
    tone === "success" ? "#047857" : tone === "failed" ? "#b91c1c" : "#1d4ed8";
  status.style.background =
    tone === "success" ? "#ecfdf5" : tone === "failed" ? "#fef2f2" : "#eff6ff";
  status.style.borderColor =
    tone === "success" ? "#a7f3d0" : tone === "failed" ? "#fecaca" : "#bfdbfe";
}

function ensureRunStatus() {
  let status = document.querySelector(`#${STATUS_ID}`);
  if (status instanceof HTMLElement) return status;
  status = document.createElement("span");
  status.id = STATUS_ID;
  status.style.display = "inline-flex";
  status.style.alignItems = "center";
  status.style.minHeight = "34px";
  status.style.padding = "6px 10px";
  status.style.border = "1px solid #bfdbfe";
  status.style.borderRadius = "8px";
  status.style.fontSize = "11px";
  status.style.fontWeight = "800";
  status.style.whiteSpace = "normal";
  status.style.maxWidth = "440px";
  status.style.background = "#eff6ff";
  status.style.color = "#1d4ed8";
  const button = document.querySelector(`#${AI_BUTTON_ID}`);
  button?.insertAdjacentElement("afterend", status);
  return status;
}

function updateReviewLinkCount(state) {
  const link = document.querySelector(`#${REVIEW_LINK_ID}`);
  if (!(link instanceof HTMLAnchorElement)) return;
  const count = state.items.filter(
    (item) =>
      item &&
      !item.archivedAt &&
      (item.categoryAiStatus === "review_required" ||
        item.categoryAiStatus === "review_held"),
  ).length;
  link.textContent = count
    ? `AI 카테고리 검토함 (${count}건)`
    : "AI 카테고리 검토함";
  link.dataset.count = String(count);
  link.style.borderColor = count ? "#f59e0b" : "";
  link.style.color = count ? "#92400e" : "";
  link.style.background = count ? "#fffbeb" : "";
}

function resetStaleAiButton() {
  const button = document.querySelector(`#${AI_BUTTON_ID}`);
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.dataset.reliableAiBusy === "1") return;
  const count = selectedItemIds().length;
  if (button.textContent?.includes("AI 분석 중")) {
    setBusyUi(button, count, false);
    setRunStatus("failed", "이전 AI 분석이 완료되지 않았습니다. 상품을 다시 선택해 실행하세요.");
  }
}

function readableError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "AI 카테고리 분석이 중단됐습니다. 화면을 유지한 채 다시 실행하세요.";
  }
  return error instanceof Error
    ? error.message
    : "AI 카테고리 자동설정에 실패했습니다.";
}
