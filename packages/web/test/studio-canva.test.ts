import { describe, it, expect, vi } from "vitest";
import { buildCanvaDeps } from "../lib/studio";

describe("buildCanvaDeps", () => {
  it("wires drive download + canva client + field resolver into CanvaRenderDeps", async () => {
    const drive = { downloadFile: vi.fn(async () => Buffer.from("p")) } as any;
    const canva = {
      getDataset: vi.fn(async () => ({ fields: [
        { name: "photo", type: "image" }, { name: "name", type: "text" }, { name: "title", type: "text" }] })),
      uploadAsset: vi.fn(async () => "a1"),
      createAutofill: vi.fn(async () => "d1"),
      exportPng: vi.fn(async () => "u1"),
      download: vi.fn(async () => Buffer.from("png")),
    } as any;
    const deps = buildCanvaDeps(drive, canva);
    expect(await deps.loadPhoto("f1")).toEqual(Buffer.from("p"));
    const ds = await deps.getDataset("t1");
    expect(deps.resolveFields(ds)).toEqual({ photo: "photo", name: "name", title: "title" });
    expect(await deps.autofill("t1", {} as any)).toBe("d1");
  });
});
