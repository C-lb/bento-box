import { describe, it, expect } from "vitest";
import { jobStatusView, transcriptionStatusView, headshotStatusView } from "../lib/status";

describe("jobStatusView", () => {
  it("maps active phases, done, and error", () => {
    expect(jobStatusView("scanning")).toEqual({ tone: "active", label: "Scanning folder" });
    expect(jobStatusView("ranking")).toEqual({ tone: "active", label: "Scoring with Claude" });
    expect(jobStatusView("done")).toEqual({ tone: "success", label: "Done" });
    expect(jobStatusView("error")).toEqual({ tone: "error", label: "Scan failed" });
    expect(jobStatusView("weird")).toEqual({ tone: "idle", label: "weird" });
  });
});

describe("transcriptionStatusView", () => {
  it("maps active phases, done, and error", () => {
    expect(transcriptionStatusView("transcribing")).toEqual({ tone: "active", label: "Transcribing audio" });
    expect(transcriptionStatusView("creating_doc")).toEqual({ tone: "active", label: "Creating the Google Doc" });
    expect(transcriptionStatusView("done")).toEqual({ tone: "success", label: "Done" });
    expect(transcriptionStatusView("error")).toEqual({ tone: "error", label: "Transcription failed" });
  });
});

describe("headshotStatusView", () => {
  it("maps rendering, done, and error", () => {
    expect(headshotStatusView("rendering")).toEqual({ tone: "active", label: "Rendering" });
    expect(headshotStatusView("done")).toEqual({ tone: "success", label: "Done" });
    expect(headshotStatusView("error")).toEqual({ tone: "error", label: "Render failed" });
  });
  it("maps autofilling", () => {
    expect(headshotStatusView("autofilling")).toEqual({ tone: "active", label: "Filling Canva template" });
  });
  it("maps exporting", () => {
    expect(headshotStatusView("exporting")).toEqual({ tone: "active", label: "Exporting from Canva" });
  });
});
