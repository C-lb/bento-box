import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

// Point the job root at a temp dir so convertDir writes there.
const tmp = mkdtempSync(resolve(tmpdir(), "conv-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { convertUploaded } from "@/lib/convert-file";
import { convertDir } from "@/lib/convert";

describe("convertUploaded (image branch)", () => {
  it("routes png→jpg and writes out.jpg", async () => {
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#123456" } }).png().toBuffer();
    const id = "testjob1";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const inPath = resolve(dir, "source");
    writeFileSync(inPath, png);
    const res = await convertUploaded(inPath, "pic.png", id, "jpg");
    expect(res).toEqual({ ext: "jpg", zip: false });
    expect(existsSync(resolve(dir, "out.jpg"))).toBe(true);
    expect((await sharp(readFileSync(resolve(dir, "out.jpg"))).metadata()).format).toBe("jpeg");
  });

  it("rejects an invalid pair", async () => {
    const id = "testjob2";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "source"), Buffer.from("x"));
    await expect(convertUploaded(resolve(dir, "source"), "a.png", id, "mp3")).rejects.toThrow();
  });

  it("routes png→html and writes a self-contained HTML file", async () => {
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#123456" } }).png().toBuffer();
    const id = "testjob3";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const inPath = resolve(dir, "source");
    writeFileSync(inPath, png);
    const res = await convertUploaded(inPath, "pic.png", id, "html");
    expect(res).toEqual({ ext: "html", zip: false });
    const html = readFileSync(resolve(dir, "out.html"), "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("data:image/png;base64,");
  });
});

describe("convertUploaded (pdf branch)", () => {
  it("routes pdf→html and writes a single combined HTML file (no zip)", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.addPage([100, 100]);
    const pdfBytes = Buffer.from(await doc.save());
    const id = "testjob4";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const inPath = resolve(dir, "source");
    writeFileSync(inPath, pdfBytes);
    const res = await convertUploaded(inPath, "deck.pdf", id, "html");
    expect(res).toEqual({ ext: "html", zip: false });
    const html = readFileSync(resolve(dir, "out.html"), "utf8");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(2);
  }, 30000);
});
