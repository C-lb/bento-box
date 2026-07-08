import { describe, it, expect, vi } from "vitest";
import { uploadWithProgress } from "@/lib/upload";

class FakeXHR {
  static last: FakeXHR;
  upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  status = 200;
  responseText = '{"id":"x"}';
  open = vi.fn();
  send = vi.fn(() => {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    this.onload?.();
  });
  constructor() { FakeXHR.last = this; }
}

describe("uploadWithProgress", () => {
  it("reports progress and resolves with parsed json", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const fracs: number[] = [];
    const res = await uploadWithProgress("/api/x", new FormData(), (f) => fracs.push(f));
    expect(fracs).toEqual([0.5]);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: "x" });
    vi.unstubAllGlobals();
  });
});
