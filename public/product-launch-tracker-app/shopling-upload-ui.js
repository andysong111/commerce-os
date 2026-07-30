const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const PREPARE_ENDPOINT = "/api/product-launch-tracker/shopling-upload";
const previewDialog = document.querySelector("#preview-dialog");
const detailForm = document.querySelector("#detail-form");
const actions = previewDialog?.querySelector(".dialog-actions");
let currentItemId = "";
let currentPreviewPersisted = false;
let activeJobId = "";
let polling = false;

if (previewDialog && actions) {
  const status = document.createElement("span");
  status.id = "shopling-upload-status";
  status.className = "shopling-upload-status";
  status.textContent = "";

  const startButton = document.createElement("button");
  startButton.id = "start-shopling-upload-button";
  startButton.className = "button button-primary";
  startButton.type = "button";
  startButton.textContent = "실제 샵플링 6채널 등록";
  startButton.disabled = true;

  actions.prepend(status, startButton);
  startButton.addEventListener("click", () => void startUpload(startButton, status));

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const rowPreview = target?.closest("button[data-action='preview']");
      if (rowPreview) {
        currentItemId = rowPreview.closest("tr[data-id]")?.dataset.id ?? "";
        currentPreviewPersisted = true;
        window.setTimeout(() => refreshButton(startButton, status), 0);
        return;
      }
      if (target?.closest("#preview-button")) {
        currentItemId = detailForm?.elements?.id?.value ?? "";
        currentPreviewPersisted = false;
        window.setTimeout(() => refreshButton(startButton, status), 0);
      }
    },
    true,
  );

  previewDialog.addEventListener("close", () => {
    if (!polling) {
      activeJobId = "";
      status.textContent = "";
    }
  });
}

function refreshButton(button, status) {
  const ready = Boolean(previewDialog?.querySelector(".preview-summary.ready"));
  button.disabled = !ready || !currentItemId || !currentPreviewPersisted || polling;
  if (!ready) {
    status.textContent = "누락값을 보완하면 실제 등록할 수 있습니다.";
  } else if (!currentPreviewPersisted) {
    status.textContent = "상세 내용을 먼저 저장한 뒤 목록의 등록 준비 버튼에서 실행하세요.";
  } else if (!polling) {
    status.textContent = "미리보기를 확인한 뒤 실행하세요.";
  }
}

async function startUpload(button, status) {
  if (!currentItemId || !currentPreviewPersisted || polling) return;
  const confirmed = window.confirm(
    "현재 미리보기 내용으로 샵플링에 도매1~소매2 상품 6개를 실제 등록할까요?\n\n이미 등록된 상품은 중복 생성하지 않도록 차단됩니다.",
  );
  if (!confirmed) return;

  polling = true;
  button.disabled = true;
  status.textContent = "최신 저장 내용을 서버에 확정하는 중입니다.";
  try {
    await flushTrackerState();
    status.textContent = "등록 작업을 준비하는 중입니다.";
    const response = await fetch(PREPARE_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ itemId: currentItemId }),
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || `등록 요청 오류 ${response.status}`);
    }
    activeJobId = String(body.jobId ?? "");
    status.textContent = "샵플링 등록 실행 대기 중입니다.";
    await pollJob(status);
  } catch (error) {
    console.error(error);
    status.textContent = error instanceof Error ? error.message : "등록 작업을 시작하지 못했습니다.";
    polling = false;
    refreshButton(button, status);
  }
}

async function flushTrackerState() {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) throw new Error("저장된 진행관리 데이터를 찾지 못했습니다.");
  let state;
  try {
    state = JSON.parse(serialized);
  } catch {
    throw new Error("저장된 진행관리 데이터가 올바르지 않습니다.");
  }
  const response = await fetch(STATE_ENDPOINT, {
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
    throw new Error(body?.message || "서버 저장을 완료하지 못했습니다.");
  }
}

async function pollJob(status) {
  const maxPolls = 120;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await wait(poll === 0 ? 1500 : 5000);
    const response = await fetch(
      `${PREPARE_ENDPOINT}?jobId=${encodeURIComponent(activeJobId)}`,
      { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || `등록 상태 확인 오류 ${response.status}`);
    }
    const job = body.job ?? {};
    if (job.status === "queued") {
      status.textContent = "샵플링 등록 실행 대기 중입니다.";
      continue;
    }
    if (job.status === "running") {
      status.textContent = "샵플링에 6개 상품을 등록하는 중입니다.";
      continue;
    }
    if (job.status === "success") {
      status.textContent = "6채널 등록이 완료되었습니다. 최신 결과를 불러옵니다.";
      await wait(900);
      window.location.reload();
      return;
    }
    if (job.status === "partial_failure" || job.status === "failed") {
      const message = String(job.error_message ?? "").trim();
      status.textContent = message || "일부 채널 등록에 실패했습니다. 최신 결과를 불러옵니다.";
      await wait(1800);
      window.location.reload();
      return;
    }
  }
  status.textContent = "등록이 계속 진행 중입니다. 잠시 뒤 화면을 다시 열어 확인하세요.";
  polling = false;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
