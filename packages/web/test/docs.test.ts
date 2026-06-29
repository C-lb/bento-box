import { describe, it, expect, vi } from "vitest";
import { createGoogleDoc } from "../lib/google/docs";

describe("createGoogleDoc", () => {
  it("creates a Google Doc from html and returns id + url", async () => {
    const create = vi.fn(async () => ({ data: { id: "doc99", webViewLink: "https://docs.google.com/doc99" } }));
    const drive = { files: { create } } as any;
    const out = await createGoogleDoc(drive, "<h1>Summary</h1><p>hi</p>", "talk transcript");
    expect(out).toEqual({ id: "doc99", url: "https://docs.google.com/doc99" });
    const arg = create.mock.calls[0][0];
    expect(arg.requestBody.mimeType).toBe("application/vnd.google-apps.document");
    expect(arg.requestBody.name).toBe("talk transcript");
    expect(arg.media.mimeType).toBe("text/html");
  });
});
