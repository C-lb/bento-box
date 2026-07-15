import { describe, it, expect } from "vitest";
import {
  categoryForFile, outputsFor, isValidConversion, extFor, convertOutName, isAudioOutput, inputExtensions,
} from "./convert-formats";

describe("categoryForFile", () => {
  it("classifies by extension, case-insensitive", () => {
    expect(categoryForFile("a.PNG")).toBe("image");
    expect(categoryForFile("a.jpg")).toBe("image");
    expect(categoryForFile("a.webp")).toBe("image");
    expect(categoryForFile("a.heic")).toBe("heic");
    expect(categoryForFile("a.pdf")).toBe("pdf");
    expect(categoryForFile("a.mp4")).toBe("audio");
    expect(categoryForFile("a.wav")).toBe("audio");
  });
  it("returns null for unknown or extensionless", () => {
    expect(categoryForFile("a.xyz")).toBeNull();
    expect(categoryForFile("noext")).toBeNull();
  });
});

describe("outputsFor", () => {
  it("lists outputs in display order, first is default", () => {
    expect(outputsFor("image")).toEqual(["png", "jpg", "webp", "pdf"]);
    expect(outputsFor("heic")).toEqual(["png", "jpg", "pdf"]);
    expect(outputsFor("pdf")).toEqual(["png", "jpg"]);
    expect(outputsFor("audio")).toEqual(["mp3", "wav", "m4a"]);
  });
});

describe("isValidConversion", () => {
  it("accepts allowed pairs and rejects the rest", () => {
    expect(isValidConversion("a.png", "pdf")).toBe(true);
    expect(isValidConversion("a.pdf", "png")).toBe(true);
    expect(isValidConversion("a.mp4", "mp3")).toBe(true);
    expect(isValidConversion("a.mp4", "pdf")).toBe(false);
    expect(isValidConversion("a.png", "mp3")).toBe(false);
    expect(isValidConversion("a.xyz", "png")).toBe(false);
  });
});

describe("extFor / isAudioOutput", () => {
  it("maps outputs to extensions", () => {
    expect(extFor("jpg")).toBe("jpg");
    expect(extFor("png")).toBe("png");
    expect(extFor("pdf")).toBe("pdf");
    expect(extFor("m4a")).toBe("m4a");
  });
  it("flags audio outputs", () => {
    expect(isAudioOutput("mp3")).toBe(true);
    expect(isAudioOutput("wav")).toBe(true);
    expect(isAudioOutput("png")).toBe(false);
  });
});

describe("inputExtensions", () => {
  it("lists every recognized extension for the file picker's accept list", () => {
    expect(inputExtensions()).toEqual([
      "png", "jpg", "jpeg", "webp", "heic", "heif", "pdf",
      "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus",
      "mp4", "mov", "mkv", "webm", "avi", "m4v",
    ]);
  });
});

describe("convertOutName", () => {
  it("swaps the extension, or uses -pages.zip for multi-page", () => {
    expect(convertOutName("holiday.png", "pdf", false)).toBe("holiday.pdf");
    expect(convertOutName("deck.pdf", "png", false)).toBe("deck.png");
    expect(convertOutName("deck.pdf", "png", true)).toBe("deck-pages.zip");
    expect(convertOutName("no-ext", "jpg", false)).toBe("no-ext.jpg");
  });
});
