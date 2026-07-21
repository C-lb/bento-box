// Shared polling helper for async-job step adapters (Task 7): sorter,
// transcribe, and studio all kick off a background job then need to wait for
// their own DB row to reach a terminal status before returning a result.

export async function pollUntilTerminal<T>(
  read: () => T | undefined,
  isTerminal: (row: T) => boolean,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<T> {
  const intervalMs = opts?.intervalMs ?? 500;
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = read();
    if (row === undefined) throw new Error("Polled row not found.");
    if (isTerminal(row)) return row;
    if (Date.now() > deadline) throw new Error(`Polling timed out after ${timeoutMs}ms.`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
