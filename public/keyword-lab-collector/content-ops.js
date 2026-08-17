(() => {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.commerceOsKeywordLabCollectorVersion = version;
  document.dispatchEvent(
    new CustomEvent("commerce-os-keyword-lab-collector-ready", {
      detail: { version },
    }),
  );
})();
