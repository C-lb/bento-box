import { describe, it, expect, vi } from "vitest";
import { makeDriveClient } from "../lib/google/drive.js";

function fakeDrive(pages: any[]) {
  let call = 0;
  return {
    files: {
      list: vi.fn(async () => ({ data: pages[Math.min(call++, pages.length - 1)] })),
    },
  } as any;
}

describe("drive client adapter", () => {
  it("lists folders", async () => {
    const drive = fakeDrive([{ files: [{ id: "f1", name: "A" }, { id: "f2", name: "B" }] }]);
    const folders = await makeDriveClient(drive).listFolders();
    expect(folders).toEqual([{ id: "f1", name: "A" }, { id: "f2", name: "B" }]);
  });

  it("paginates images across pages", async () => {
    const drive = fakeDrive([
      { files: [{ id: "i1", name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: "t1" }], nextPageToken: "p2" },
      { files: [{ id: "i2", name: "b.png", mimeType: "image/png", thumbnailLink: null }] },
    ]);
    const imgs = await makeDriveClient(drive).listImages("folder1");
    expect(imgs.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(imgs[0]).toMatchObject({ name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: "t1" });
  });
});

describe("downloadFile", () => {
  it("returns the raw bytes from files.get alt=media", async () => {
    const fake = {
      files: {
        get: async (params: any) => {
          expect(params.fileId).toBe("F1");
          expect(params.alt).toBe("media");
          return { data: new TextEncoder().encode("RAWBYTES").buffer };
        },
      },
      context: { _options: { auth: {} } },
    };
    const buf = await makeDriveClient(fake as any).downloadFile("F1");
    expect(buf.toString()).toBe("RAWBYTES");
  });
});
