(() => {
  "use strict";

  const TOKEN_PARAM = "commerce_os_pipeline_token";
  const CANARY_PREFIX = "commerce-os-canary-pipeline:";
  const PIPE_PREFIX = "commerce-os-pipeline:";

  function text(value) {
    return String(value ?? "").trim();
  }

  function knownWorkerPath() {
    return /\/prod\/prodList\.phtml$/i.test(location.pathname)
      || /\/prodlinkage\/goods_mallReg_idChoice\.phtml$/i.test(location.pathname)
      || /\/prodlinkage\/goods_mallReg_preProdChoice\.phtml$/i.test(location.pathname);
  }

  function tokenFromName(value, prefix) {
    const name = text(value);
    if (!name.startsWith(prefix)) return "";
    return name.slice(prefix.length).trim();
  }

  function removeTokenFromVisibleUrl() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has(TOKEN_PARAM)) return;
      url.searchParams.delete(TOKEN_PARAM);
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Best effort only.
    }
  }

  const topLevel = window.top === window;
  const queryToken = new URLSearchParams(location.search).get(TOKEN_PARAM) || "";

  if (topLevel) {
    if (queryToken && !knownWorkerPath()) {
      try {
        window.name = `${CANARY_PREFIX}${queryToken}`;
      } catch {
        // Best effort only.
      }
      removeTokenFromVisibleUrl();
      return;
    }

    const parked = tokenFromName(window.name, CANARY_PREFIX);
    if (parked && knownWorkerPath()) {
      try {
        window.name = `${PIPE_PREFIX}${parked}`;
      } catch {
        // Best effort only.
      }
    }
    return;
  }

  let inherited = "";
  try {
    inherited = tokenFromName(window.top?.name, CANARY_PREFIX);
  } catch {
    inherited = "";
  }
  if (!inherited) return;

  try {
    window.name = `${PIPE_PREFIX}${inherited}`;
  } catch {
    // Best effort only.
  }
})();
