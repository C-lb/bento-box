import { describe, expect, it } from "vitest";
import { applyRetry, isBatchSettled, type BatchHeadshot } from "../app/studio/batch/StudioBatchClient";

function hs(id: number, status: string, errorMessage: string | null = null): BatchHeadshot {
  return { id, status, imageUrl: null, errorMessage, nameText: `Row ${id}` };
}

describe("studio batch retry re-arms polling after settle", () => {
  it("isBatchSettled is true only when every row is terminal", () => {
    expect(isBatchSettled([])).toBe(false);
    expect(isBatchSettled([hs(1, "pending")])).toBe(false);
    expect(isBatchSettled([hs(1, "done"), hs(2, "pending")])).toBe(false);
    expect(isBatchSettled([hs(1, "done"), hs(2, "error", "boom")])).toBe(true);
    expect(isBatchSettled([hs(1, "done")])).toBe(true);
  });

  it("applyRetry flips the retried row to pending and clears its error", () => {
    const before = [hs(1, "done"), hs(2, "error", "render failed")];
    const after = applyRetry(before, 2);
    expect(after[1]).toMatchObject({ id: 2, status: "pending", errorMessage: null });
    // Other rows untouched.
    expect(after[0]).toEqual(before[0]);
    // Pure: input not mutated.
    expect(before[1].status).toBe("error");
  });

  it("retry on a fully settled batch un-settles it, re-arming the poll gate", () => {
    // This is the regression: the poll's `active` = !!batchId && !isBatchSettled(rows).
    // After settle, active is false; a pollKey bump alone re-runs an effect that
    // early-returns on !active. applyRetry must flip settled back to false so
    // usePollWhileVisible re-activates (and fires an immediate fetch).
    const settled = [hs(1, "done"), hs(2, "error", "boom")];
    expect(isBatchSettled(settled)).toBe(true);
    const retried = applyRetry(settled, 2);
    expect(isBatchSettled(retried)).toBe(false);
  });

  it("polling stops again once the retried row settles", () => {
    const retried = applyRetry([hs(1, "done"), hs(2, "error", "boom")], 2);
    // Server finishes the retry: next poll payload has the row terminal again.
    const next = retried.map((h) => (h.id === 2 ? { ...h, status: "done" } : h));
    expect(isBatchSettled(next)).toBe(true);
  });
});
