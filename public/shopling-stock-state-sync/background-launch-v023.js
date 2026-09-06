importScripts("background-v023.js");
// Acquire the preparation mutex before the first await (multiple OPS tabs may request a run).
const startWithAdminWorkspaceV023 = start;
let preparingStockV023 = false;
start = async function guardedStockStartV023(input) {
  if (preparingStockV023) return { ok: false, code: "STOCK_SYNC_PREPARING", message: "작업창을 준비 중입니다. 중복 실행하지 마세요." };
  preparingStockV023 = true;
  try { return await startWithAdminWorkspaceV023(input); }
  finally { preparingStockV023 = false; }
};
