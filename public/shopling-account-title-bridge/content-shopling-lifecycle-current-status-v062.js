(() => {
  "use strict";

  const SESSION_KEY = "commerceOsShoplingLifecycleTaskContext";
  const STAGE_SEARCHED = "search-submitted";
  const STAGE_VERIFY = "verify-submitted";

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function desiredStatus(desiredState) {
    if (desiredState === "SELLING") return "B";
    if (desiredState === "SOLD_OUT") return "C";
    if (desiredState === "DELETE") return "Z";
    return "";
  }

  function lifecycleQuery() {
    const params = new URLSearchParams(location.search);
    if (params.get("commerce_os_lifecycle") !== "1") return null;
    const currentSaleStatus = text(params.get("commerce_os_lifecycle_current"));
    const desiredState = text(params.get("commerce_os_lifecycle_state"));
    return {
      currentSaleStatus: /^[BC]$/.test(currentSaleStatus) ? currentSaleStatus : "",
      desiredState,
    };
  }

  function storedStage() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      return text(stored?.stage);
    } catch {
      return "";
    }
  }

  function statusForSubmit() {
    const query = lifecycleQuery();
    if (!query) return "";
    const stage = storedStage();
    if (stage === STAGE_SEARCHED) return query.currentSaleStatus;
    if (stage === STAGE_VERIFY) return desiredStatus(query.desiredState);
    return "";
  }

  function applyStatusFilter() {
    const value = statusForSubmit();
    if (!value) return false;
    const select = document.querySelector('select[name="sale_status"], select#sale_status');
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = [...select.options].find((row) => text(row.value) === value);
    if (!option) return false;
    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return select.value === option.value;
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, input[type="button"], input[type="submit"], a')
      : null;
    if (!target) return;
    const label = text(target.value || target.textContent || target.innerText || "");
    if (!/^(?:검색|조회)$/i.test(label)) return;
    applyStatusFilter();
  }, true);

  document.addEventListener("submit", () => {
    applyStatusFilter();
  }, true);
})();
