importScripts("background-v025.js");

(() => {
  const VERSION = "0.2.6";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const ACK_WAIT_MS = 2_000;
  const ACK_RETRY_MS = 25;

  const sleepV026 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadStateV026() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function completeOnSubmitAck(jobId) {
    const deadline = Date.now() + ACK_WAIT_MS;
    while (Date.now() < deadline) {
      const state = await loadStateV026();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || !job || job.status !== "RUNNING") return;
      if (job.stage === "RESULT_WAIT") {
        await completeJob(
          job.id,
          `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 요청 접수 완료 · Shopling 원본 송신 ACK 기준 통과 · 마켓별 결과 검증 생략 v${VERSION}`,
        );
        return;
      }
      await sleepV026(ACK_RETRY_MS);
    }
  }

  // 운영 우선 정책: MAIN world 원본 송신 함수가 성공 응답하고 RESULT_WAIT 단계까지 도달하면
  // 개별 마켓 결과창을 기다리지 않고 해당 작업을 완료 처리한다.
  // base listener가 RESULT_WAIT을 storage에 기록한 뒤 완료하도록 짧게 폴링해 상태 경합을 피한다.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "A21_STAGE" || String(message.stage || "") !== "RESULT_WAIT" || !message.jobId) return false;
    setTimeout(() => void completeOnSubmitAck(String(message.jobId)), 10);
    return false;
  });
})();
