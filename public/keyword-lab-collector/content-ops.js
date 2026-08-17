(() => {
  const host = location.hostname.toLowerCase();
  const allowed =
    host === "commerce-os-ops-center.vercel.app" ||
    (host.startsWith("commerce-os-ops-center-") && host.endsWith(".vercel.app"));
  if (!allowed) return;

  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.commerceOsKeywordLabCollectorVersion = version;
  document.dispatchEvent(
    new CustomEvent("commerce-os-keyword-lab-collector-ready", {
      detail: { version },
    }),
  );
})();
