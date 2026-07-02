import { describe, it, expect, vi } from "vitest";
import { makeDriveClient } from "../lib/google/drive";

function fakeDrive(overrides: any = {}) {
  return {
    files: {
      list: vi.fn(async () => ({ data: { files: [{ id: "p1", name: "Deck.pptx" }], nextPageToken: undefined } })),
      create: vi.fn(async () => ({ data: { id: "up1", webViewLink: "https://drive/up1" } })),
      ...overrides,
    },
  } as any;
}

describe("drive slice helpers", () => {
  it("lists presentations in a folder", async () => {
    const drive = fakeDrive();
    const client = makeDriveClient(drive);
    const res = await client.listPresentations("folderX");
    expect(res).toEqual([{ id: "p1", name: "Deck.pptx" }]);
    const q = drive.files.list.mock.calls[0][0].q as string;
    expect(q).toContain("'folderX' in parents");
    expect(q).toContain("presentationml.presentation");
  });

  it("uploads a pdf and returns id + url", async () => {
    const drive = fakeDrive();
    const client = makeDriveClient(drive);
    const res = await client.uploadPdf("Intro.pdf", new Uint8Array([1, 2, 3]), "folderX");
    expect(res).toEqual({ id: "up1", url: "https://drive/up1" });
    const arg = drive.files.create.mock.calls[0][0];
    expect(arg.requestBody.name).toBe("Intro.pdf");
    expect(arg.requestBody.parents).toEqual(["folderX"]);
    expect(arg.media.mimeType).toBe("application/pdf");
  });
});
