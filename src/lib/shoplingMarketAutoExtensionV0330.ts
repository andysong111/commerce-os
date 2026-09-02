export const COMMERCE_OS_MARKET_AUTO_BRIDGE_V0330 = String.raw`(() => {
  "use strict";
  if (globalThis.__commerceOsShoplingMarketAutoBridgeV0330) return;
  globalThis.__commerceOsShoplingMarketAutoBridgeV0330 = true;

  const PROBE = "commerce-os-shopling-market-auto-probe-v0330";
  const PROBE_ACK = "commerce-os-shopling-market-auto-probe-ack-v0330";
  const HANDOFF = "commerce-os-shopling-market-auto-handoff-v0330";
  const HANDOFF_ACK = "commerce-os-shopling-market-auto-handoff-ack-v0330";
  const BG_HANDOFF = "commerce-os-shopling-market-auto-bg-handoff-v0330";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function reply(type, requestId, payload) {
    window.postMessage({ type, requestId, version: "0.3.30", ...payload }, window.location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data && typeof event.data === "object" ? event.data : null;
    if (!data) return;
    const type = text(data.type);
    const requestId = text(data.requestId);
    if (!requestId) return;
    if (type === PROBE) {
      reply(PROBE_ACK, requestId, { ok: true });
      return;
    }
    if (type !== HANDOFF) return;
    const token = text(data.token);
    const orchestrationId = text(data.orchestrationId);
    if (!/^[A-Za-z0-9_-]{32,180}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(orchestrationId)) {
      reply(HANDOFF_ACK, requestId, { ok: false, error: "invalid_handoff" });
      return;
    }
    try {
      chrome.runtime.sendMessage(
        { type: BG_HANDOFF, token, orchestrationId },
        (response) => {
          const lastError = chrome.runtime.lastError;
          reply(HANDOFF_ACK, requestId, {
            ok: !lastError && response && response.ok === true,
            error: lastError ? String(lastError.message || lastError) : text(response && response.error),
          });
        },
      );
    } catch (error) {
      reply(HANDOFF_ACK, requestId, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  });
})();
`;

export const SHOPLING_MARKET_AUTO_AGENT_V0330 = String.raw`(() => {
  "use strict";
  if (globalThis.__commerceOsShoplingMarketAutoAgentV0330) return;
  globalThis.__commerceOsShoplingMarketAutoAgentV0330 = true;
  if (window.top !== window) return;

  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";
  const BG_TICK = "commerce-os-shopling-market-auto-bg-tick-v0330";
  const BG_HEARTBEAT = "commerce-os-shopling-market-auto-bg-heartbeat-v0330";
  const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";
  const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0330";
  const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0330";
  const ACTIVE_KEY = "commerceOsShoplingMarketAutoActiveV0330";
  const TICK_MS = 4000;
  const HEARTBEAT_MS = 30000;
  let busy = false;

  function text(value) {
    return String(value == null ? "" : value).normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function send(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (stored) => {
        void chrome.runtime.lastError;
        resolve(stored || {});
      });
    });
  }

  function set(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, () => {
        void chrome.runtime.lastError;
        resolve(values);
      });
    });
  }

  function remove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => {
        void chrome.runtime.lastError;
        resolve(true);
      });
    });
  }

  function isTerminalQueue(status) {
    return ["completed", "completed_with_exceptions", "failed", "confirm_needed"].includes(text(status));
  }

  async function ensureAutoIntent(active) {
    const stored = await get([QUEUE_KEY, INTENT_KEY]);
    const queue = stored[QUEUE_KEY] || null;
    if (queue && queue.status === "running") return false;
    if (queue && Number(queue.startedAt || 0) >= Number(active.startedAt || 0)) return false;
    const intent = stored[INTENT_KEY] || null;
    if (intent && intent.status === "pending" && Number(intent.createdAt || 0) >= Number(active.startedAt || 0)) return false;
    await set({
      [INTENT_KEY]: {
        version: "0.3.30",
        status: "pending",
        jobIds: Array.isArray(active.jobIds) ? active.jobIds : [],
        createdAt: Date.now(),
        autoOrchestrationId: active.orchestrationId,
      },
    });
    return true;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const context = await send({ type: CONTEXT_MESSAGE, candidateGoodsKeys: [] });
      if (context && context.worker) return;
      const stored = await get([QUEUE_KEY, ACTIVE_KEY]);
      const queue = stored[QUEUE_KEY] || null;
      const active = stored[ACTIVE_KEY] || null;

      if (active && active.token && active.orchestrationId) {
        const queueStartedAt = Number(queue && queue.startedAt || 0);
        const activeStartedAt = Number(active.startedAt || 0);
        if (queue && queue.status === "running" && queueStartedAt >= activeStartedAt) {
          const lastHeartbeatAt = Number(active.lastHeartbeatAt || 0);
          if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
            const beat = await send({
              type: BG_HEARTBEAT,
              token: active.token,
              orchestrationId: active.orchestrationId,
            });
            if (beat && beat.ok) {
              await set({ [ACTIVE_KEY]: { ...active, lastHeartbeatAt: Date.now() } });
            }
          }
          return;
        }
        if (queue && queueStartedAt >= activeStartedAt && isTerminalQueue(queue.status)) {
          const reported = await send({
            type: BG_REPORT,
            token: active.token,
            orchestrationId: active.orchestrationId,
            queueStatus: text(queue.status),
          });
          if (reported && reported.ok && reported.terminal) {
            await remove(ACTIVE_KEY);
          } else if (reported && reported.ok) {
            await set({ [ACTIVE_KEY]: { ...active, lastHeartbeatAt: Date.now() } });
          }
          return;
        }
        await ensureAutoIntent(active);
        return;
      }

      if (queue && queue.status === "running") return;
      const claim = await send({ type: BG_TICK });
      if (!claim || claim.ok !== true || claim.ready !== true) return;
      const jobIds = Array.isArray(claim.jobIds) ? claim.jobIds.map(text).filter((value) => /^[0-9a-f-]{36}$/i.test(value)) : [];
      if (!jobIds.length) return;
      const next = {
        token: text(claim.token),
        orchestrationId: text(claim.orchestrationId),
        jobIds,
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
      };
      await set({ [ACTIVE_KEY]: next });
      await ensureAutoIntent(next);
    } finally {
      busy = false;
    }
  }

  setInterval(() => void tick(), TICK_MS);
  setTimeout(() => void tick(), 400);
})();
`;
