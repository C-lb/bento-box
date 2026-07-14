import { describe, it, expect } from "vitest";
import { sofficeCandidates, resolveSofficePath, readSlides, sofficeConvertArgs } from "../lib/pptx-convert";
import JSZip from "jszip";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("sofficeCandidates", () => {
  it("includes the macOS app bundle path on darwin", () => {
    const c = sofficeCandidates("darwin", {});
    expect(c).toContain("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  });
  it("honors an explicit override via env", () => {
    const c = sofficeCandidates("linux", { EE_SOFFICE_PATH: "/opt/soffice" });
    expect(c[0]).toBe("/opt/soffice");
  });
});

describe("resolveSofficePath", () => {
  it("returns the first existing candidate", () => {
    expect(resolveSofficePath(["/a", "/b", "/c"], (p) => p === "/b")).toBe("/b");
  });
  it("returns null when none exist", () => {
    expect(resolveSofficePath(["/a"], () => false)).toBe(null);
  });
});

describe("sofficeConvertArgs", () => {
  it("puts an isolated UserInstallation profile first so concurrent runs don't share an instance", () => {
    const args = sofficeConvertArgs("/tmp/run/deck.pptx", "/tmp/run", "/tmp/prof");
    // The -env: switch MUST precede --headless or soffice ignores it and falls
    // back to the shared default profile, which is the whole bug.
    expect(args[0]).toBe("-env:UserInstallation=file:///tmp/prof");
    expect(args.indexOf("--headless")).toBeGreaterThan(0);
  });
  it("passes convert-to pdf, the outdir, and the source deck", () => {
    const args = sofficeConvertArgs("/tmp/run/deck.pptx", "/tmp/out", "/tmp/prof");
    expect(args).toContain("pdf");
    expect(args[args.indexOf("--outdir") + 1]).toBe("/tmp/out");
    expect(args[args.length - 1]).toBe("/tmp/run/deck.pptx");
  });
});

describe("readSlides", () => {
  it("reads per-slide text and notes from a pptx zip in slide order", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:t>First</a:t></p:sld>`);
    zip.file("ppt/slides/slide2.xml", `<p:sld><a:t>Second</a:t></p:sld>`);
    zip.file("ppt/notesSlides/notesSlide2.xml", `<p:notes><a:t>Note two</a:t></p:notes>`);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const dir = await mkdtemp(join(tmpdir(), "pptx-"));
    const path = join(dir, "deck.pptx");
    await writeFile(path, buf);

    const slides = await readSlides(path);
    expect(slides).toEqual([
      { index: 1, text: "First", notes: "" },
      { index: 2, text: "Second", notes: "Note two" },
    ]);
  });
});
