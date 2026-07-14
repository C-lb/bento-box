import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateLongUrl,
  validateCustomName,
  buildCreateUrl,
  mapServiceError,
} from "@/lib/shorten";
import { POST } from "@/app/api/shorten/route";

afterEach(() => vi.restoreAllMocks());

function req(body: unknown) {
  return new Request("http://x/api/shorten", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("validateLongUrl", () => {
  it("accepts a plain http url", () => {
    expect(validateLongUrl("http://example.com")).toBeNull();
  });
  it("accepts a plain https url", () => {
    expect(validateLongUrl("https://example.com/foo?bar=1")).toBeNull();
  });
  it("rejects empty input", () => {
    expect(validateLongUrl("")).not.toBeNull();
  });
  it("rejects a non-url string", () => {
    expect(validateLongUrl("not a url")).not.toBeNull();
  });
  it("rejects a non-http(s) scheme", () => {
    expect(validateLongUrl("ftp://example.com")).not.toBeNull();
  });
});

describe("validateCustomName", () => {
  it("accepts undefined (optional field)", () => {
    expect(validateCustomName(undefined)).toBeNull();
  });
  it("accepts a valid 5-char name", () => {
    expect(validateCustomName("abcde")).toBeNull();
  });
  it("accepts a valid 30-char name", () => {
    expect(validateCustomName("a".repeat(30))).toBeNull();
  });
  it("accepts underscores and digits", () => {
    expect(validateCustomName("my_link_123")).toBeNull();
  });
  it("rejects a name shorter than 5 chars", () => {
    expect(validateCustomName("abcd")).not.toBeNull();
  });
  it("rejects a name longer than 30 chars", () => {
    expect(validateCustomName("a".repeat(31))).not.toBeNull();
  });
  it("rejects disallowed characters", () => {
    expect(validateCustomName("bad name!")).not.toBeNull();
  });
});

describe("buildCreateUrl", () => {
  it("encodes the url and requests json format", () => {
    const out = buildCreateUrl("is.gd", "https://example.com/a b");
    expect(out).toContain("https://is.gd/create.php");
    expect(out).toContain("format=json");
    expect(out).toContain(`url=${encodeURIComponent("https://example.com/a b")}`);
  });
  it("includes the shorturl param when a custom name is given", () => {
    const out = buildCreateUrl("is.gd", "https://example.com", "mylink");
    expect(out).toContain("shorturl=mylink");
  });
  it("omits the shorturl param when no custom name is given", () => {
    const out = buildCreateUrl("is.gd", "https://example.com");
    expect(out).not.toContain("shorturl=");
  });
  it("builds against v.gd when that service is requested", () => {
    const out = buildCreateUrl("v.gd", "https://example.com");
    expect(out).toContain("https://v.gd/create.php");
  });
});

const UNAVAILABLE = "The shortening service is unavailable. Try again later.";

describe("mapServiceError", () => {
  it("maps code 1 (bad url)", () => {
    expect(mapServiceError(1)).toBe("That doesn't look like a valid link.");
  });
  it("maps code 2 (bad custom name / already taken)", () => {
    expect(mapServiceError(2)).toBe("That custom name is taken or not allowed. Try another.");
  });
  it("maps code 3 (rate limited)", () => {
    expect(mapServiceError(3)).toBe("Rate limit reached. Wait a moment and try again.");
  });
  it("maps code 4 (any other error / maintenance) to the unavailable message", () => {
    expect(mapServiceError(4)).toBe(UNAVAILABLE);
  });
  it("falls back to the unavailable message for an undefined code", () => {
    expect(mapServiceError(undefined)).toBe(UNAVAILABLE);
  });
  it("falls back to the unavailable message for an unknown code", () => {
    expect(mapServiceError(99)).toBe(UNAVAILABLE);
  });
});

describe("POST /api/shorten", () => {
  it("returns the shortened url on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ shorturl: "https://is.gd/abc123" }), { status: 200 }),
    );
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shorturl).toBe("https://is.gd/abc123");
  });

  it("maps a service error response to a 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errorcode: 1, errormessage: "bad url" }), { status: 200 }),
    );
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 502 with a network-blocked message when the upstream fetch throws", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/could not reach/i);
    // Falls back to the sibling service before giving up.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 with a network-blocked message on a non-JSON upstream response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>maintenance</html>", { status: 200 }));
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/could not reach/i);
  });

  it("returns 502 with a network-blocked message when a 200 response has no shorturl", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/could not reach/i);
  });

  it("does not fall back on a real service error (e.g. bad url)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ errorcode: 1 }), { status: 200 }));
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 on invalid body (missing url)", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed json body", async () => {
    const badReq = new Request("http://x/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a service outside the is.gd/v.gd whitelist", async () => {
    const res = await POST(req({ url: "https://example.com", service: "evil.example" }));
    expect(res.status).toBe(400);
  });

  it("defaults to is.gd when no service is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shorturl: "https://is.gd/abc123" }), { status: 200 }));
    await POST(req({ url: "https://example.com" }));
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("is.gd");
  });

  it("passes an AbortSignal so requests time out", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shorturl: "https://is.gd/abc123" }), { status: 200 }));
    await POST(req({ url: "https://example.com" }));
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
