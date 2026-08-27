"use client";

import { useEffect } from "react";

const FRAME_ID = "product-launch-tracker-frame";
const BUTTON_ID = "completed-archive-button";
const OPTIMIZED_API = "/api/product-launch-tracker/optimized";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function selectedCompletedItemIds(doc: Document) {
  return [
    ...new Set(
      Array.from(doc.querySelectorAll<HTMLInputElement>("#launch-table-body .row-check:checked"))
        .map((checkbox) => text(checkbox.closest<HTMLTableRowElement>("tr[data-id]")?.dataset.id))
        .filter(Boolean),
    ),
  ];
}

async function archiveItems(itemIds: string[]) {
  const response = await fetch(OPTIMIZED_API, {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation: "archive_items",
      itemIds,
      archived: true,
      updatedBy: "등록완료건 보관함 이동",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `HTTP ${response.status}`);
  }
}

function installButton(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return () => {};

  const controls = doc.querySelector<HTMLElement>(".bulk-controls");
  const overall = doc.querySelector<HTMLSelectElement>("#overall-filter");
  if (!controls || !overall) return () => {};

  let button = doc.querySelector<HTMLButtonElement>(`#${BUTTON_ID}`);
  if (!button) {
    button = doc.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = "보관함 이동";
    controls.appendChild(button);
  }

  const syncVisibility = () => {
    if (!button) return;
    button.hidden = overall.value !== "완료";
    button.title = overall.value === "완료"
      ? "선택한 등록완료 상품을 보관함으로 이동합니다."
      : "등록완료건 화면에서 사용할 수 있습니다.";
  };

  const onClick = async () => {
    const itemIds = selectedCompletedItemIds(doc);
    if (!itemIds.length) {
      win.alert("보관함으로 이동할 등록완료 상품을 먼저 선택해 주세요.");
      return;
    }
    if (!win.confirm(`선택한 등록완료 상품 ${itemIds.length}건을 보관함으로 이동할까요?`)) return;

    if (button) button.disabled = true;
    try {
      await archiveItems(itemIds);
      win.location.reload();
    } catch (error) {
      win.alert(error instanceof Error ? error.message : "보관함 이동에 실패했습니다.");
      if (button) button.disabled = false;
    }
  };

  syncVisibility();
  overall.addEventListener("change", syncVisibility);
  button.addEventListener("click", onClick);
  win.addEventListener("product-launch-tracker:page-loaded", syncVisibility);

  return () => {
    overall.removeEventListener("change", syncVisibility);
    button?.removeEventListener("click", onClick);
    win.removeEventListener("product-launch-tracker:page-loaded", syncVisibility);
  };
}

export function ProductLaunchCompletedArchiveButtonBridge() {
  useEffect(() => {
    const frame = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
    if (!frame) return;

    let cleanup = () => {};
    const install = () => {
      cleanup();
      cleanup = installButton(frame);
    };

    frame.addEventListener("load", install);
    install();
    return () => {
      frame.removeEventListener("load", install);
      cleanup();
    };
  }, []);

  return null;
}
