import { describe, it, expect } from "vitest";
import { normalizeName, extractDriveId, matchRow } from "../src/match.js";

const files = [
  { id: "fA", name: "Jane Doe.jpg" },
  { id: "fB", name: "john_smith.PNG" },
  { id: "fC", name: "Jane Doe (1).jpg" },
];

describe("normalizeName", () => {
  it("strips extension, lowercases, collapses punctuation", () => {
    expect(normalizeName("Jane_Doe.JPG")).toBe("jane doe");
    expect(normalizeName("  John–Smith.png ")).toBe("john smith");
  });
});

describe("extractDriveId", () => {
  it("pulls id from a /file/d/ url", () => {
    expect(extractDriveId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
  it("pulls id from ?id=", () => {
    expect(extractDriveId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz12345")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
  it("returns a bare id-shaped token", () => {
    expect(extractDriveId("1AbCdEfGhIjKlMnOpQrStUvWxYz12345")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
  it("returns null for a plain filename", () => {
    expect(extractDriveId("jane doe.jpg")).toBeNull();
  });
});

describe("matchRow", () => {
  it("resolves a drive url in the photo column", () => {
    const r = matchRow({ name: "x", photoCell: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view", folderFiles: files });
    expect(r).toEqual({ status: "matched", driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz12345" });
  });
  it("matches a photo-column filename against the folder", () => {
    const r = matchRow({ name: "x", photoCell: "john smith.png", folderFiles: files });
    expect(r).toEqual({ status: "matched", driveFileId: "fB" });
  });
  it("matches by name when no photo column", () => {
    const r = matchRow({ name: "John Smith", folderFiles: files });
    expect(r).toEqual({ status: "matched", driveFileId: "fB" });
  });
  it("flags ambiguous when multiple files normalize equal", () => {
    const r = matchRow({ name: "Jane Doe", folderFiles: [{ id: "fA", name: "jane doe.jpg" }, { id: "fC", name: "Jane-Doe.png" }] });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toEqual(["fA", "fC"]);
  });
  it("flags unmatched when nothing matches", () => {
    expect(matchRow({ name: "Nobody Here", folderFiles: files }).status).toBe("unmatched");
  });
});
