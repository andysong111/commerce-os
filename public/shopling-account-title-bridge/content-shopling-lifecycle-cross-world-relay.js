(() => {
  "use strict";

  const COMMAND_EVENT = "commerce-os-shopling-lifecycle-main-command";
  const RESULT_EVENT = "commerce-os-shopling-lifecycle-main-result";
  const RELAY_FLAG = "__commerceOsShoplingLifecycleRelayed";
  const RELAY_VERSION = "v0.5.9";
  const isolatedWorld = typeof chrome === "object" && Boolean(chrome?.runtime?.id);
  const eventName = isolatedWorld ? RESULT_EVENT : COMMAND_EVENT;

  function detailOf(event) {
    try {
      const detail = event && typeof event === "object" ? event.detail : null;
      return detail && typeof detail === "object" ? detail : null;
    } catch {
      return null;
    }
  }

  function relayDetail(detail) {
    if (isolatedWorld) {
      return {
        token: String(detail.token ?? ""),
        ok: detail.ok === true,
        clicked: detail.clicked === true,
        error: String(detail.error ?? ""),
        bridgeVersion: String(detail.bridgeVersion ?? ""),
        relayVersion: RELAY_VERSION,
        [RELAY_FLAG]: true,
      };
    }
    return {
      token: String(detail.token ?? ""),
      action: String(detail.action ?? ""),
      allowDelete: detail.allowDelete === true,
      relayVersion: RELAY_VERSION,
      [RELAY_FLAG]: true,
    };
  }

  window.addEventListener(eventName, (event) => {
    const detail = detailOf(event);
    if (!detail || detail[RELAY_FLAG] === true) return;

    // Chrome isolated worlds share the DOM but not JavaScript prototypes.
    // Re-dispatch the payload as a local CustomEvent so downstream code can
    // safely use its own world-local CustomEvent semantics.
    try {
      event.stopImmediatePropagation?.();
    } catch {
      // Best effort; the re-dispatched event still carries the local payload.
    }
    window.dispatchEvent(new CustomEvent(eventName, { detail: relayDetail(detail) }));
  }, true);
})();
