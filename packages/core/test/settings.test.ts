import { describe, it, expect } from "vitest";
import { getConnections } from "../src/settings.js";

describe("getConnections", () => {
  it("reports unconfigured when env empty", () => {
    const conns = getConnections({});
    expect(conns.map((c) => c.id).sort()).toEqual(["anthropic", "canva", "google"]);
    expect(conns.every((c) => c.configured === false)).toBe(true);
  });

  it("reports google configured when its vars present", () => {
    const conns = getConnections({
      GOOGLE_CLIENT_ID: "x",
      GOOGLE_CLIENT_SECRET: "y",
    });
    expect(conns.find((c) => c.id === "google")?.configured).toBe(true);
    expect(conns.find((c) => c.id === "anthropic")?.configured).toBe(false);
  });
});
