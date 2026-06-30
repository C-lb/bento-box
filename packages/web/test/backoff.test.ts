import { describe, it, expect, vi } from "vitest";
import { withBackoff } from "../lib/backoff";

describe("withBackoff", () => {
  it("retries on 429 then succeeds", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ === 0) throw Object.assign(new Error("rl"), { status: 429, retryAfter: 0 });
      return "ok";
    });
    expect(await withBackoff(fn, { tries: 3 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fn = vi.fn(async () => { throw Object.assign(new Error("bad"), { status: 400 }); });
    await expect(withBackoff(fn, { tries: 3 })).rejects.toThrow("bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retryOn override catches 5xx", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ === 0) throw Object.assign(new Error("srv"), { status: 503, retryAfter: 0 });
      return 7;
    });
    const out = await withBackoff(fn, { tries: 3, retryOn: (s) => s !== undefined && s >= 500 });
    expect(out).toBe(7);
  });
});
