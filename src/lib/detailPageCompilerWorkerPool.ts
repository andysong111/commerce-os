export const DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE = 3;

export function detailPageWorkerSlot(itemId: unknown, poolSize = DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE) {
  const size = Math.max(1, Math.floor(Number(poolSize) || 1));
  const value = String(itemId ?? "").trim();
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}
