import { describe, it, expect } from "vitest";
import type { Tool } from "@/components/tools";
import type { ConnectionId } from "@event-editor/core/settings";
import {
  toolReadiness,
  requirementTooltip,
  settingsHref,
  type Health,
} from "@/components/tool-readiness";

const base: Tool = {
  id: "x", href: "/x", title: "X", body: "b",
  Icon: (() => null) as unknown as Tool["Icon"],
  defaultGroups: [], tags: [],
};

const health: Health = {
  keys: [
    { id: "groq", configured: false },
    { id: "anthropic", configured: true },
    { id: "google", configured: true },
    { id: "canva", configured: false },
  ],
  deps: [
    { id: "ffmpeg", ready: true },
    { id: "ytdlp", ready: false },
    { id: "libreoffice", ready: false },
  ],
};

describe("toolReadiness", () => {
  it("is ready when the tool has no requirements", () => {
    expect(toolReadiness(base, health).ready).toBe(true);
  });

  it("is ready when all required keys are configured", () => {
    const t = { ...base, requires: { keys: ["anthropic", "google"] as const } };
    expect(toolReadiness(t as unknown as Tool, health).ready).toBe(true);
  });

  it("blocks when a required key is missing", () => {
    const t = { ...base, requires: { keys: ["groq"] as const } };
    const r = toolReadiness(t as unknown as Tool, health);
    expect(r.ready).toBe(false);
    expect(r.missingKeys).toEqual(["groq"]);
  });

  it("blocks when a required dep is missing", () => {
    const t = { ...base, requires: { deps: ["libreoffice"] as const } };
    const r = toolReadiness(t as unknown as Tool, health);
    expect(r.ready).toBe(false);
    expect(r.missingDeps).toEqual(["libreoffice"]);
  });

  it("reports both missing keys and deps", () => {
    const t = { ...base, requires: { keys: ["groq"] as const, deps: ["libreoffice"] as const } };
    const r = toolReadiness(t as unknown as Tool, health);
    expect(r.ready).toBe(false);
    expect(r.missingKeys).toEqual(["groq"]);
    expect(r.missingDeps).toEqual(["libreoffice"]);
  });

  it("ignores unknown ids (treats as satisfied)", () => {
    const t = { ...base, requires: { keys: ["bogus"] as unknown as ConnectionIdArr } };
    expect(toolReadiness(t as unknown as Tool, health).ready).toBe(true);
  });

  it("builds a needs-X tooltip listing every missing item", () => {
    const r = { ready: false, missingKeys: ["groq"] as const, missingDeps: ["libreoffice"] as const };
    expect(requirementTooltip(r as never)).toBe(
      "Feature not available: needs Groq API key, LibreOffice",
    );
  });

  it("links to api-keys when a key is missing, else dependencies", () => {
    expect(settingsHref({ ready: false, missingKeys: ["groq"], missingDeps: [] } as never)).toBe("/settings#api-keys");
    expect(settingsHref({ ready: false, missingKeys: [], missingDeps: ["libreoffice"] } as never)).toBe("/settings#dependencies");
  });
});

type ConnectionIdArr = readonly ConnectionId[];
