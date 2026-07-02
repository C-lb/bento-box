import { describe, it, expect } from "vitest";
import { sliceStatusView } from "../lib/status";

describe("sliceStatusView", () => {
  it("maps known statuses", () => {
    expect(sliceStatusView("converting").tone).toBe("active");
    expect(sliceStatusView("done").tone).toBe("success");
    expect(sliceStatusView("error").tone).toBe("error");
  });
  it("falls back to idle with the raw label", () => {
    expect(sliceStatusView("weird")).toEqual({ tone: "idle", label: "weird" });
  });
});
