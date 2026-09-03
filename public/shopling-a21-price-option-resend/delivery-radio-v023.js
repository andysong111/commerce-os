(() => {
  const TARGET_NAME = "trsmt_env_mody_dlvyinfo";

  function neutralizeDeliveryNoticeClick() {
    const radios = [...document.querySelectorAll(`input[type="radio"][name="${TARGET_NAME}"]`)];
    const keepUnchanged = radios.find((radio) => String(radio.value ?? "") === "");
    const modify = radios.find((radio) => String(radio.value ?? "") === "Y");
    if (!(keepUnchanged instanceof HTMLInputElement) || !(modify instanceof HTMLInputElement)) return false;

    // Shopling 기본값은 배송정보=수정(Y)이고, 수정안함(blank) 라디오에는
    // onclick="dlvy_notice();"가 붙어 있어 자동 클릭 시 native alert가 먼저 떠서
    // 화면 재도색과 후속 자동화를 막을 수 있다. 안내만 제거하고 radio 의미는 유지한다.
    keepUnchanged.removeAttribute("onclick");
    try { keepUnchanged.onclick = null; } catch { /* no-op */ }
    keepUnchanged.dataset.commerceOsDeliveryUnchanged = "true";
    return true;
  }

  if (neutralizeDeliveryNoticeClick()) return;
  const observer = new MutationObserver(() => {
    if (neutralizeDeliveryNoticeClick()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 10000);
})();
