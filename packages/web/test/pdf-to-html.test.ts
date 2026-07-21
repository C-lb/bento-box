import { describe, it, expect } from "vitest";
import { pagesToHtml, imageToHtml } from "@/lib/pdf-to-html";

function tinyPng(): Buffer {
  // 1x1 transparent PNG, valid minimal PNG bytes.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

describe("pagesToHtml", () => {
  it("embeds one base64 image per page in a single HTML document", () => {
    const html = pagesToHtml([tinyPng(), tinyPng(), tinyPng()], "My Deck").toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("My Deck");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(3);
  });

  it("throws on an empty page list", () => {
    expect(() => pagesToHtml([])).toThrow();
  });
});

describe("imageToHtml", () => {
  it("embeds a single image with the given mime type", () => {
    const html = imageToHtml(tinyPng(), "image/png", "My Photo").toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("My Photo");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(1);
  });
});
