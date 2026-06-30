export interface BackoffOpts {
  tries?: number;
  retryOn?: (status: number | undefined) => boolean;
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOpts = {}): Promise<T> {
  const tries = opts.tries ?? 6;
  const retryOn = opts.retryOn ?? ((s) => s === 429 || s === 529);
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status: number | undefined = err?.status ?? err?.statusCode;
      if (!retryOn(status)) throw err;
      const delayMs =
        typeof err?.retryAfter === "number" && Number.isFinite(err.retryAfter)
          ? Math.min(err.retryAfter * 1000, 300_000)
          : 1000 * 2 ** i;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
