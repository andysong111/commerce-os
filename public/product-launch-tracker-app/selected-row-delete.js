const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";

export function buildDeletedTrackerState(
  storedState,
  selectedItemIds,
  savedAt = new Date().toISOString(),
) {
  const source =
    storedState && typeof storedState === "object" && !Array.isArray(storedState)
      ? storedState
      : {};
  const items = Array.isArray(source.items) ? source.items : [];
  const selectedIds = new Set(
    [...(selectedItemIds ?? [])]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const existingIds = new Set(
    items.map((item) => String(item?.id ?? "").trim()).filter(Boolean),
  );
  const deletedIds = [...selectedIds].filter((id) => existingIds.has(id));
  const tombstones = new Set([
    ...stringArray(source.serverDeletedItemIds),
    ...deletedIds,
  ]);

  return {
    deletedIds,
    nextState: {
      ...source,
      schemaVersion: positiveInteger(source.schemaVersion, 3),
      savedAt,
      items: items.filter(
        (item) => !selectedIds.has(String(item?.id ?? "").trim()),
      ),
      serverDeletedItemIds: [...tombstones],
    },
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installSelectedRowDelete();
}

function installSelectedRowDelete() {
  const bulkControls = document.querySelector(".bulk-controls");
  const tableBody = document.querySelector("#launch-table-body");
  const selectVisible = document.querySelector("#select-visible");
  const clearSelectionButton = document.querySelector("#clear-selection-button");
  if (!bulkControls || !tableBody || !selectVisible || !clearSelectionButton) return;
  if (document.querySelector("#delete-selected-button")) return;

  const selectedIds = new Set();
  const deleteButton = document.createElement("button");
  deleteButton.id = "delete-selected-button";
  deleteButton.className = "button button-danger";
  deleteButton.type = "button";
  deleteButton.textContent = "선택 삭제";
  deleteButton.disabled = true;
  deleteButton.title = "체크한 행을 진행관리 목록에서 완전히 삭제합니다.";
  bulkControls.insertBefore(deleteButton, clearSelectionButton);

  tableBody.addEventListener("change", (event) => {
    if (!(event.target instanceof Element) || !event.target.matches(".row-check")) {
      return;
    }
    queueMicrotask(syncVisibleSelection);
  });
  selectVisible.addEventListener("change", () => queueMicrotask(syncVisibleSelection));
  clearSelectionButton.addEventListener("click", () => {
    selectedIds.clear();
    syncDeleteButton();
  });
  deleteButton.addEventListener("click", deleteSelectedRows);

  const observer = new MutationObserver(syncVisibleSelection);
  observer.observe(tableBody, { childList: true, subtree: true });
  syncVisibleSelection();

  function syncVisibleSelection() {
    for (const row of tableBody.querySelectorAll("tr[data-id]")) {
      const id = String(row.dataset.id ?? "").trim();
      const checkbox = row.querySelector(".row-check");
      if (!id || !(checkbox instanceof HTMLInputElement)) continue;
      if (checkbox.checked) selectedIds.add(id);
      else selectedIds.delete(id);
    }
    syncDeleteButton();
  }

  function syncDeleteButton() {
    const count = selectedIds.size;
    deleteButton.disabled = count < 1;
    deleteButton.textContent = count > 0 ? `선택 ${formatNumber(count)}건 삭제` : "선택 삭제";
    deleteButton.setAttribute("aria-disabled", String(count < 1));
  }

  function deleteSelectedRows() {
    const stored = readStoredState();
    if (!stored || !Array.isArray(stored.items)) {
      showToast("저장된 진행관리 데이터를 찾지 못했습니다.");
      return;
    }

    const selectedItems = stored.items.filter((item) =>
      selectedIds.has(String(item?.id ?? "").trim()),
    );
    const preview = selectedItems
      .slice(0, 5)
      .map((item) => `${String(item?.modelNumber ?? "").trim()} ${String(item?.productName ?? "").trim()}`.trim())
      .filter(Boolean)
      .join("\n");
    const remainder = selectedItems.length > 5 ? `\n외 ${formatNumber(selectedItems.length - 5)}건` : "";

    if (!selectedItems.length) {
      selectedIds.clear();
      syncDeleteButton();
      showToast("삭제할 행을 다시 선택해 주세요.");
      return;
    }

    const confirmed = window.confirm(
      `${formatNumber(selectedItems.length)}개 행을 완전히 삭제할까요?\n\n${preview}${remainder}\n\n삭제 후 새로고침해도 복구되지 않습니다.`,
    );
    if (!confirmed) return;

    const { deletedIds, nextState } = buildDeletedTrackerState(
      stored,
      selectedIds,
    );
    if (!deletedIds.length) {
      showToast("삭제할 행을 찾지 못했습니다.");
      return;
    }

    const saveStatus = document.querySelector("#save-status");
    if (saveStatus) saveStatus.textContent = "삭제 저장 중";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    selectedIds.clear();
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, {
        detail: {
          typingGuardBypass: true,
          source: "selected-row-delete",
          deletedIds,
        },
      }),
    );
    syncDeleteButton();
    showToast(`${formatNumber(deletedIds.length)}개 행을 삭제했습니다.`);
  }
}

function readStoredState() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

let toastTimer;
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}
