(() => {
  "use strict";

  const BRIDGE_ID = "commerce-os-shopling-account-title-bridge";
  const SAVE_BUTTON_ID = `${BRIDGE_ID}-save`;
  const STATUS_ID = `${BRIDGE_ID}-status`;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function status(message, error = false) {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = error ? "#b91c1c" : "#166534";
  }

  function nativeSaveButton() {
    const changedInput = document.querySelector('input[data-commerce-os-diversified="1"]');
    const form = changedInput?.closest("form") || document.querySelector("form");
    const scope = form || document;
    const candidates = [...scope.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
    return candidates.find((element) => {
      if (element.id === SAVE_BUTTON_ID || element.closest(`#${BRIDGE_ID}`)) return false;
      if (element.disabled) return false;
      return text(element.value || element.innerText || element.textContent || "") === "저장";
    }) || null;
  }

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target?.closest?.(`#${SAVE_BUTTON_ID}`);
      if (!button) return;
      setTimeout(() => {
        const changed = document.querySelectorAll('input[data-commerce-os-diversified="1"]').length;
        if (!changed) return;
        const native = nativeSaveButton();
        if (!native) {
          status("상품명 분산은 완료됐지만 Shopling 저장 버튼을 찾지 못했습니다. 화면의 저장을 직접 눌러주세요.", true);
          return;
        }
        status(`계정별 상품명 ${changed}개를 Shopling에 저장합니다.`);
        native.click();
      }, 450);
    },
    true,
  );
})();
