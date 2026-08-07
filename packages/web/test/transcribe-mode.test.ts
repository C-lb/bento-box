import { describe, expect, it } from "vitest";
import { resetFileStageOnModeSwitch } from "@/lib/transcribe-mode";

describe("resetFileStageOnModeSwitch", () => {
  it("clears hasFile when switching away from audio with a staged file", () => {
    const result = resetFileStageOnModeSwitch({ hasFile: true, hasDocFile: false }, "document");
    expect(result).toEqual({ hasFile: false, hasDocFile: false });
  });

  it("clears hasDocFile when switching away from document with a staged file", () => {
    const result = resetFileStageOnModeSwitch({ hasFile: false, hasDocFile: true }, "audio");
    expect(result).toEqual({ hasFile: false, hasDocFile: false });
  });

  it("clears both flags even if somehow both were set", () => {
    const result = resetFileStageOnModeSwitch({ hasFile: true, hasDocFile: true }, "audio");
    expect(result).toEqual({ hasFile: false, hasDocFile: false });
  });

  it("is a no-op in effect when nothing was staged", () => {
    const result = resetFileStageOnModeSwitch({ hasFile: false, hasDocFile: false }, "document");
    expect(result).toEqual({ hasFile: false, hasDocFile: false });
  });
});
