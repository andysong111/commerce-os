const TRANSIENT_DETAIL_PAGE_STORE_PATTERN =
  /statement timeout|canceling statement due to statement timeout|connection to the database timed out|database.*timed out|connection.*timed out|status=50[0234]|status=504|service unavailable|gateway timeout|fetch failed|econnreset|etimedout|socket hang up/i;

export async function withDetailPageStoreRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  const safeAttempts = Math.max(1, Math.min(4, Math.floor(attempts) || 1));

  for (let attempt = 1; attempt <= safeAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDetailPageStoreError(error) || attempt >= safeAttempts) {
        throw error;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 250 * attempt),
      );
    }
  }

  throw lastError;
}

export function isTransientDetailPageStoreError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return TRANSIENT_DETAIL_PAGE_STORE_PATTERN.test(message);
}
