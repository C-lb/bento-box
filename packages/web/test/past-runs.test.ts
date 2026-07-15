import { describe, it, expect } from "vitest";
import { runFileUrl, modeLabel } from "@/lib/past-runs";

describe("runFileUrl", () => {
  it("pdf outputs hit the file route with the stored name", () => {
    expect(runFileUrl("pdf", { id: "abc", filename: "deck-compressed.pdf" })).toBe(
      "/api/pdf/file/abc?name=deck-compressed.pdf",
    );
  });

  it("pdf split zips get kind=zip derived from the filename", () => {
    expect(runFileUrl("pdf", { id: "abc", filename: "deck-split.zip" })).toBe(
      "/api/pdf/file/abc?name=deck-split.zip&kind=zip",
    );
    // case-insensitive extension match
    expect(runFileUrl("pdf", { id: "abc", filename: "deck-split.ZIP" })).toContain("&kind=zip");
  });

  it("encodes filenames in the query", () => {
    expect(runFileUrl("pdf", { id: "abc", filename: "a b.pdf" })).toBe(
      "/api/pdf/file/abc?name=a%20b.pdf",
    );
  });

  it("resize passes the served extension, defaulting to jpg", () => {
    expect(runFileUrl("resize", { id: "r1", filename: "photo.png" })).toBe(
      "/api/resize/r1?name=photo.png&ext=png",
    );
    expect(runFileUrl("resize", { id: "r1", filename: "photo.webp" })).toBe(
      "/api/resize/r1?name=photo.webp&ext=webp",
    );
    expect(runFileUrl("resize", { id: "r1", filename: "photo.jpg" })).toBe(
      "/api/resize/r1?name=photo.jpg&ext=jpg",
    );
    // unknown or missing extensions fall back to the route's jpg default
    expect(runFileUrl("resize", { id: "r1", filename: "photo" })).toBe(
      "/api/resize/r1?name=photo&ext=jpg",
    );
  });

  it("video only needs the name", () => {
    expect(runFileUrl("video", { id: "v1", filename: "clip-compressed.mp4" })).toBe(
      "/api/video/v1?name=clip-compressed.mp4",
    );
  });

  it("splice adds kind=audio for m4a outputs", () => {
    expect(runFileUrl("splice", { id: "s1", filename: "joined.mp4" })).toBe(
      "/api/splice/s1?name=joined.mp4",
    );
    expect(runFileUrl("splice", { id: "s1", filename: "joined.m4a" })).toBe(
      "/api/splice/s1?name=joined.m4a&kind=audio",
    );
  });

  it("convert passes any served extension and defaults to mp3", () => {
    expect(runFileUrl("convert", { id: "c1", filename: "song.mp3" })).toBe(
      "/api/convert/c1?ext=mp3&name=song.mp3",
    );
    expect(runFileUrl("convert", { id: "c1", filename: "scan-pages.zip" })).toBe(
      "/api/convert/c1?ext=zip&name=scan-pages.zip",
    );
    expect(runFileUrl("convert", { id: "c1", filename: "pic.webp" })).toBe(
      "/api/convert/c1?ext=webp&name=pic.webp",
    );
    // extensions the route can't serve fall back to its mp3 default
    expect(runFileUrl("convert", { id: "c1", filename: "weird.xyz" })).toBe(
      "/api/convert/c1?ext=mp3&name=weird.xyz",
    );
  });
});

describe("modeLabel", () => {
  it("returns null when there is no mode", () => {
    expect(modeLabel(null)).toBeNull();
    expect(modeLabel(undefined)).toBeNull();
    expect(modeLabel("")).toBeNull();
  });

  it("sentence-cases stored modes", () => {
    expect(modeLabel("merge")).toBe("Merge");
    expect(modeLabel("split")).toBe("Split");
    expect(modeLabel("compress")).toBe("Compress");
    expect(modeLabel("trim")).toBe("Trim");
    expect(modeLabel("join")).toBe("Join");
  });

  it("reads convert's url mode as Link", () => {
    expect(modeLabel("url")).toBe("Link");
    expect(modeLabel("file")).toBe("File");
  });
});
