const summary = document.getElementById("summary");
const card = document.getElementById("card");
const barcode = document.getElementById("barcode");
const mode = document.getElementById("mode");
const target = document.getElementById("target");
const stage = document.getElementById("stage");
const message = document.getElementById("message");
const stop = document.getElementById("stop");

function render(state) {
  if (!state) {
    summary.textContent = "현재 실행 중인 Shopling 재고상태 작업이 없습니다.";
    card.hidden = true;
    stop.hidden = true;
    return;
  }
  card.hidden = false;
  barcode.textContent = state.barcode || "-";
  mode.textContent = state.productMode === "SINGLE" ? "단품 · A6→A21" : "옵션상품 · A6→A22";
  target.textContent = state.desiredStatus === "SOLD_OUT" ? "품절" : "판매중";
  stage.textContent = state.stage || "-";
  message.textContent = state.message || "";
  summary.textContent = state.status === "RUNNING"
    ? "실제 Shopling 화면을 순서대로 처리하고 있습니다."
    : state.status === "SUCCEEDED"
      ? "작업이 완료되었습니다."
      : "작업이 중단되었거나 실패했습니다.";
  stop.hidden = state.status !== "RUNNING";
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "SHOPLING_LIFECYCLE_STATE" }).catch(() => null);
  render(response?.state || null);
}

stop.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SHOPLING_LIFECYCLE_STOP" }).catch(() => null);
  await refresh();
});

void refresh();
setInterval(() => void refresh(), 800);
