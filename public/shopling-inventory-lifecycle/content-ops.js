(() => {
  const VERSION = "0.1.0";

  function post(type, payload = null) {
    window.postMessage(
      { type, payload, version: VERSION },
      window.location.origin,
    );
  }

  async function ping() {
    const response = await chrome.runtime
      .sendMessage({ type: "OPS_LIFECYCLE_PING" })
      .catch(() => null);
    if (response?.ok) {
      post("COMMERCE_OS_SHOPLING_LIFECYCLE_READY", {
        version: response.version,
        state: response.state,
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "COMMERCE_OS_SHOPLING_LIFECYCLE_PING") {
      void ping();
      return;
    }
    if (event.data.type === "COMMERCE_OS_SHOPLING_LIFECYCLE_RUN") {
      void chrome.runtime
        .sendMessage({
          type: "OPS_LIFECYCLE_RUN",
          payload: event.data.payload,
        })
        .then((response) => {
          if (response?.ok) {
            post("COMMERCE_OS_SHOPLING_LIFECYCLE_READY", {
              version: response.version,
              state: response.job,
            });
          } else {
            post("COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT", {
              ...event.data.payload,
              state: "FAILED",
              stage: "START",
              errorCode: response?.error || "SHOPLING_EXTENSION_START_FAILED",
              message:
                response?.error || "Shopling 재고상태 작업을 시작하지 못했습니다.",
            });
          }
        })
        .catch((error) => {
          post("COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT", {
            ...event.data.payload,
            state: "FAILED",
            stage: "START",
            errorCode: "SHOPLING_EXTENSION_UNAVAILABLE",
            message: String(error?.message || error || "확장프로그램 연결 실패"),
          });
        });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      message?.type === "COMMERCE_OS_SHOPLING_LIFECYCLE_EVENT" ||
      message?.type === "COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT"
    ) {
      post("COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT", message.payload);
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  });

  void ping();
})();
