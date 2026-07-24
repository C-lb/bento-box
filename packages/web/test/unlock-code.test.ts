import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePreset, parseExtraCodes, DEFAULT_UNLOCK_CODE } from "../app/settings/preset";
import { applyUnlockCode } from "../app/settings/actions";

function tmpFile() {
  return join(tmpdir(), `ee-unlock-${Math.random().toString(36).slice(2)}.env`);
}

describe("resolvePreset", () => {
  it("falls back to the default code when nothing sets one", () => {
    expect(resolvePreset({}, {}).code).toBe(DEFAULT_UNLOCK_CODE);
  });

  it("prefers the file code over the default, and the process env over both", () => {
    expect(resolvePreset({ EE_UNLOCK_CODE: "file-code" }, {}).code).toBe("file-code");
    expect(resolvePreset({ EE_UNLOCK_CODE: "file-code" }, { EE_UNLOCK_CODE: "env-code" }).code).toBe("env-code");
    expect(resolvePreset({ EE_UNLOCK_CODE: "file-code" }, { EE_UNLOCK_CODE: "  " }).code).toBe("file-code");
  });

  it("prefers file key values over process env, skipping blanks", () => {
    const p = resolvePreset(
      { GROQ_API_KEY: "gsk_file" },
      { GROQ_API_KEY: "gsk_env", ANTHROPIC_API_KEY: "sk-ant-env" },
    );
    expect(p.keys).toEqual({ GROQ_API_KEY: "gsk_file", ANTHROPIC_API_KEY: "sk-ant-env" });
    expect(resolvePreset({}, { GROQ_API_KEY: "  " }).keys).toEqual({});
  });
});

describe("parseExtraCodes", () => {
  it("treats a bare code as unlocking everything and a suffixed one as scoped", () => {
    expect(parseExtraCodes("plain,dewibento:groq|claude")).toEqual([
      { code: "plain", scope: null },
      { code: "dewibento", scope: ["GROQ_API_KEY", "ANTHROPIC_API_KEY"] },
    ]);
  });

  it("drops unknown groups, leaving an empty scope", () => {
    expect(parseExtraCodes("x:nope")).toEqual([{ code: "x", scope: [] }]);
  });
});

describe("applyUnlockCode", () => {
  const files: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const f of files.splice(0)) rmSync(f, { force: true });
  });

  function setup(sourceContent: string) {
    const source = tmpFile();
    const dest = tmpFile();
    files.push(source, dest);
    writeFileSync(source, sourceContent);
    vi.stubEnv("EE_PRESET_ENV", source);
    vi.stubEnv("EE_ENV_FILE", dest);
    vi.stubEnv("EE_UNLOCK_CODE", "");
    return dest;
  }

  function form(code: string) {
    const fd = new FormData();
    fd.set("code", code);
    return fd;
  }

  it("rejects an empty or wrong code without writing anything", async () => {
    const dest = setup("EE_UNLOCK_CODE=letmein\nGROQ_API_KEY=gsk_1\n");
    expect((await applyUnlockCode(null, form("")))?.ok).toBe(false);
    expect((await applyUnlockCode(null, form("nope")))?.ok).toBe(false);
    expect(() => readFileSync(dest, "utf8")).toThrow();
  });

  it("fills both keys into the user env file on a matching code", async () => {
    const dest = setup("EE_UNLOCK_CODE=letmein\nGROQ_API_KEY=gsk_1\nANTHROPIC_API_KEY=sk-ant-2\n");
    const res = await applyUnlockCode(null, form("letmein"));
    expect(res?.ok).toBe(true);
    expect(res?.message).toContain("Groq and Claude");
    const out = readFileSync(dest, "utf8");
    expect(out).toMatch(/^GROQ_API_KEY=gsk_1$/m);
    expect(out).toMatch(/^ANTHROPIC_API_KEY=sk-ant-2$/m);
  });

  it("a scoped extra code fills only the keys its groups cover", async () => {
    const dest = setup(
      "EE_UNLOCK_CODE=letmein\nEE_UNLOCK_CODES=dewibento:groq|claude\n" +
        "GROQ_API_KEY=gsk_1\nANTHROPIC_API_KEY=sk-ant-2\nGOOGLE_CLIENT_ID=goog_3\nSPOTIFY_CLIENT_ID=spot_4\n",
    );
    const res = await applyUnlockCode(null, form("dewibento"));
    expect(res?.ok).toBe(true);
    const out = readFileSync(dest, "utf8");
    expect(out).toMatch(/^GROQ_API_KEY=gsk_1$/m);
    expect(out).toMatch(/^ANTHROPIC_API_KEY=sk-ant-2$/m);
    expect(out).not.toMatch(/GOOGLE_CLIENT_ID/);
    expect(out).not.toMatch(/SPOTIFY_CLIENT_ID/);
  });

  it("reports when the code matches but no preset keys exist", async () => {
    setup("EE_UNLOCK_CODE=letmein\n");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await applyUnlockCode(null, form("letmein"));
    expect(res?.ok).toBe(false);
    expect(res?.message).toContain("no preset keys");
  });
});
