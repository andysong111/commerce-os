(() => {
  const VERSION = "0.4.5";
  const WAKE_MESSAGE = "COMMERCE_OS_SHOPLING_STOCK_SYNC_WAKE";
  const STATUS_MESSAGE = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";
  let fetching = false;

  function notify(message) {
    try {
      window.postMessage(
        { type: STATUS_MESSAGE, message: String(message || ""), version: VERSION },
        window.location.origin,
      );
    } catch {
      // Page notification is best-effort only.
    }
  }

  async function loadTasks() {
    if (fetching) return;
    fetching = true;
    try {
      const response = await fetch("/api/inventory-truth", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload?.message || "Shopling 판매상태 대기작업 조회 실패");
        return;
      }
      const tasks = Array.isArray(payload?.pendingTasks)
        ? payload.pendingTasks
        : [];
      await chrome.runtime.sendMessage({
        type: "COMMERCE_OS_STOCK_TASKS",
        tasks,
        version: VERSION,
      });
      if (tasks.length) notify(`Shopling 판매상태 동기화 대기 ${tasks.length}건 전달`);
    } catch (error) {
      notify(error?.message || "Shopling 판매상태 작업 전달 실패");
    } finally {
      fetching = false;
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type === WAKE_MESSAGE) void loadTasks();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "COMMERCE_OS_STOCK_SYNC_RESULT") return false;
    void (async () => {
      try {
        const response = await fetch("/api/inventory-truth", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            action: "SYNC_RESULT",
            taskId: message.task?.taskId,
            barcode: message.task?.barcode,
            targetState: message.task?.targetState,
            productKind: message.task?.productKind,
            success: message.success === true,
            message: message.message || "",
            payload: message.payload || null,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        notify(
          payload?.message ||
            (message.success
              ? "Shopling 판매상태 동기화 완료"
              : "Shopling 판매상태 동기화 실패"),
        );
        sendResponse({ ok: response.ok, payload });
        setTimeout(() => void loadTasks(), 800);
      } catch (error) {
        notify(error?.message || "Shopling 동기화 결과 저장 실패");
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  });

  setTimeout(() => void loadTasks(), 1200);
  setInterval(() => void loadTasks(), 20_000);
})();
