import { vi, describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

// Mock LibreOffice + conversion so the test never shells out and deterministically
// reaches the driveFileId validation.
vi.mock("@/lib/pptx-convert", () => ({
  findSoffice: () => "/usr/bin/soffice",
  convertToPdf: vi.fn(),
  readSlides: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: vi.fn(async () => null),
}));

import { POST } from "@/app/api/slice/convert/route";

async function sliceEntries(): Promise<string[]> {
  try {
    return await readdir(resolve("data/slice"));
  } catch {
    return [];
  }
}

describe("convert route validation ordering", () => {
  it("returns 400 and creates no run dir when driveFileId is missing", async () => {
    const before = await sliceEntries();
    const req = new Request("http://x/api/slice/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const after = await sliceEntries();
    expect(after).toEqual(before);
  });

  it("returns 400 and creates no run dir when Google is not connected", async () => {
    const before = await sliceEntries();
    const req = new Request("http://x/api/slice/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driveFileId: "abc" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const after = await sliceEntries();
    expect(after).toEqual(before);
  });
});
