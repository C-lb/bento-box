import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const tmp = mkdtempSync(resolve(tmpdir(), "resizehist-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const mocks = vi.hoisted(() => ({
  resizeImage: vi.fn(async () => ({ data: Buffer.from("img"), ext: "jpg" as const })),
  createToolRun: vi.fn<(db: unknown, args: unknown) => string>(() => "run-id"),
}));

vi.mock("@/lib/resize", () => ({ resizeImage: mocks.resizeImage }));
vi.mock("@event-editor/core/tool-runs", () => ({ createToolRun: mocks.createToolRun }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { POST } from "@/app/api/resize/route";

function request(name = "photo.png") {
  const fd = new FormData();
  fd.set("file", new File([Buffer.from("fake-image")], name, { type: "image/png" }));
  fd.set("format", "jpg");
  return POST(new Request("http://x/api/resize", { method: "POST", body: fd }));
}

beforeEach(() => {
  mocks.resizeImage.mockClear().mockResolvedValue({ data: Buffer.from("img"), ext: "jpg" });
  mocks.createToolRun.mockClear().mockReturnValue("run-id");
});

describe("resize route history recording", () => {
  it("records one run per request with the output id and filename", async () => {
    const res = await request("photo.png");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.createToolRun).toHaveBeenCalledTimes(1);
    expect(mocks.createToolRun.mock.calls[0][1]).toEqual({
      tool: "resize",
      label: "photo.png",
      outputs: [{ id: body.id, filename: body.filename }],
    });
  });

  it("does not record a run when the resize fails", async () => {
    mocks.resizeImage.mockRejectedValue(new Error("bad image"));
    const res = await request();
    expect(res.status).toBe(500);
    expect(mocks.createToolRun).not.toHaveBeenCalled();
  });

  it("still returns the successful resize when recording throws", async () => {
    mocks.createToolRun.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    const res = await request("photo.png");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filename).toBe("photo.jpg");
  });
});
