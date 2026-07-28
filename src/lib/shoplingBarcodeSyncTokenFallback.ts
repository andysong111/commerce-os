export function applyShoplingBarcodeSyncTokenFallback() {
  const dedicatedToken = process.env.SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN?.trim();
  if (dedicatedToken) return "SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN";

  const engineDispatchToken = process.env.GITHUB_ENGINE_DISPATCH_TOKEN?.trim();
  if (engineDispatchToken) {
    process.env.SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN = engineDispatchToken;
    return "GITHUB_ENGINE_DISPATCH_TOKEN";
  }

  return null;
}
