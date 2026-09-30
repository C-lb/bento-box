import { describe, it, expect } from "vitest";
import { ytDlpCandidates, resolveExisting, sanitizeConvertId, denoCandidates, cookiesBrowser, childEnv } from "./convert";

describe("ytDlpCandidates", () => {
  it("puts an explicit override first", () => {
    const c = ytDlpCandidates({ EE_YTDLP_PATH: "/opt/yt-dlp" }, "darwin");
    expect(c[0]).toBe("/opt/yt-dlp");
  });
  it("includes the managed bin path from EE_BIN_DIR", () => {
    const c = ytDlpCandidates({ EE_BIN_DIR: "/data/bin" }, "darwin");
    expect(c).toContain("/data/bin/yt-dlp");
  });
  it("uses yt-dlp.exe on win32", () => {
    const c = ytDlpCandidates({ EE_BIN_DIR: "C:/data/bin" }, "win32");
    expect(c).toContain("C:/data/bin/yt-dlp.exe");
  });
  it("includes a common homebrew install path", () => {
    const c = ytDlpCandidates({}, "darwin");
    expect(c).toContain("/opt/homebrew/bin/yt-dlp");
  });
  it("contains only real paths (no bare-name fallback)", () => {
    const c = ytDlpCandidates({}, "darwin");
    expect(c.every((p) => p.includes("/"))).toBe(true);
  });
});

describe("resolveExisting", () => {
  it("returns the first existing candidate", () => {
    expect(resolveExisting(["/a", "/b", "/c"], (p) => p === "/b")).toBe("/b");
  });
  it("returns null when none exist", () => {
    expect(resolveExisting(["/a", "/b"], () => false)).toBe(null);
  });
});

describe("sanitizeConvertId", () => {
  it("strips characters outside the id alphabet", () => {
    expect(sanitizeConvertId("../ab-9_x")).toBe("ab-9_x");
  });
});

describe("denoCandidates", () => {
  it("puts an explicit override first, then homebrew, then ~/.deno", () => {
    const c = denoCandidates({ EE_DENO_PATH: "/x/deno" }, "darwin", "/Users/me");
    expect(c[0]).toBe("/x/deno");
    expect(c).toContain("/opt/homebrew/bin/deno");
    expect(c[c.length - 1]).toBe("/Users/me/.deno/bin/deno");
  });
  it("uses deno.exe on win32", () => {
    expect(denoCandidates({}, "win32", "C:/u").pop()).toBe("C:/u/.deno/bin/deno.exe");
  });
});

describe("cookiesBrowser", () => {
  it("is off unless the env names a browser", () => {
    expect(cookiesBrowser({})).toBe(null);
    expect(cookiesBrowser({ EE_YTDLP_COOKIES_BROWSER: " Chrome " })).toBe("chrome");
  });
  it("rejects anything that is not a bare browser name", () => {
    expect(cookiesBrowser({ EE_YTDLP_COOKIES_BROWSER: "chrome:Default --evil" })).toBe(null);
  });
});

describe("childEnv", () => {
  it("appends the common tool dirs to PATH without duplicating them", () => {
    const e = childEnv({ PATH: "/usr/bin:/opt/homebrew/bin" });
    const parts = (e.PATH ?? "").split(":");
    expect(parts.filter((p) => p === "/opt/homebrew/bin")).toHaveLength(1);
    expect(parts).toContain("/usr/local/bin");
    expect(parts[0]).toBe("/usr/bin");
  });
});
