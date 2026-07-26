export type NormalDispatchingReconciliation = "wait" | "block_uncertain" | "none";

export function decideNormalDispatchingReconciliation({
  chunkStatus,
  startedAt,
  now,
}: {
  chunkStatus: unknown;
  startedAt: unknown;
  now: number;
}): NormalDispatchingReconciliation {
  if (chunkStatus !== "dispatching") return "none";
  const started = typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(started)) return "block_uncertain";
  return now - started < 120_000 ? "wait" : "block_uncertain";
}
