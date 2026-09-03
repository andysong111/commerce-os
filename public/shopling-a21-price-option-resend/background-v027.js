importScripts("background-v020.js");

(() => {
  const VERSION = "0.2.7";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const ACK_WAIT_MS = 2_000;
  const ACK_RETRY_MS = 20;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadState() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function completeOnSubmitAck(jobId) {
    const deadline = Date.now() + ACK_WAIT_MS;
    while (Date.now() < deadline) {
      const state = await loadState();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || !job || job.status !== "RUNNING") return;
      if (job.stage === "RESULT_WAIT") {
        await completeJob(
          job.id,
          `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 요청 접수 완료 · Shopling 송신 ACK 기준 즉시 통과 · 결과 검증 없음 v${VERSION}`,
        );
        return;
      }
      await sleep(ACK_RETRY_MS);
    }
  }

  // v0.2.7은 결과 추적용 v0.2.4/v0.2.5 레이어를 아예 로드하지 않는다.
  // MAIN world 원본 송신이 정상 응답하여 RESULT_WAIT에 도달하는 순간 해당 작업을 완료하고 다음 작업을 즉시 시작한다.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "A21_STAGE" || String(message.stage || "") !== "RESULT_WAIT" || !message.jobId) return false;
    setTimeout(() => void completeOnSubmitAck(String(message.jobId)), 5);
    return false;
  });
})();
